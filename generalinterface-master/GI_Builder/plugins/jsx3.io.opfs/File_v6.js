/*
 * Copyright (c) 2001-2011, TIBCO Software Inc.
 * Use, modification, and distribution subject to terms of license.
 */

(function() {
    // Virtual File System State (Encapsulated inside IIFE to prevent global namespace pollution)
    var files = {};
    var directories = new Set();

    function normalizePath(path) {
        if (!path) return "";
        path = path.replace(/\//g, "\\");
        
        // Remove trailing backslash except for drive roots like "C:\"
        if (path.endsWith("\\") && path.length > 3) {
            path = path.substring(0, path.length - 1);
        }
        
        // Ensure root drive letter always ends with backslash (e.g. "C" -> "C:\", "C:" -> "C:\")
        if (path.match(/^[a-zA-Z]:?$/)) {
            if (!path.endsWith(":")) {
                path += ":";
            }
            path += "\\";
        }
        
        return path;
    }

    function getParentOf(path) {
        if (path === "C:\\" || path.match(/^[a-zA-Z]:\\$/)) return null;
        var idx = path.lastIndexOf("\\");
        if (idx < 0) return null;
        var parent = path.substring(0, idx);
        return normalizePath(parent);
    }

    function pathToURI(path, isDir) {
        var p = path.replace(/\\/g, "/");
        if (isDir && !p.endsWith("/")) {
            p += "/";
        }
        if (!p.startsWith("/")) p = "/" + p;
        return jsx3.net.URI.valueOf("file://" + p);
    }

    // Load virtual filesystem state from localStorage at startup
    function loadFS() {
        try {
            var raw = localStorage.getItem("__OPFS_VIRTUAL_FS__");
            if (raw) {
                var data = JSON.parse(raw);
                files = data.files || {};
                directories = new Set(data.directories || []);
                // Initialize roots if empty
                if (directories.size === 0) {
                    directories.add("C:\\");
                    directories.add("C:\\projects");
                }
                return;
            }
        } catch (e) {
            console.error("Failed to load virtual FS from localStorage:", e);
        }
        
        // Default fallback state
        files = {};
        directories = new Set();
        directories.add("C:\\");
        directories.add("C:\\projects");
        
        // Trigger background restore from OPFS
        loadFromOPFS();
    }

    // Background sync to OPFS
    async function saveToOPFS(data) {
        if (!navigator.storage || !navigator.storage.getDirectory) return;
        try {
            const root = await navigator.storage.getDirectory();
            
            for (const filePath in data.files) {
                const content = data.files[filePath];
                const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
                if (parts.length === 0) continue;
                
                let dirHandle = root;
                // Traverse folders
                for (let i = 0; i < parts.length - 1; i++) {
                    let part = parts[i];
                    if (part.endsWith(":")) {
                        part = part.slice(0, -1);
                    }
                    dirHandle = await dirHandle.getDirectoryHandle(part, { create: true });
                }
                
                const fileName = parts[parts.length - 1];
                const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(content);
                await writable.close();
            }
        } catch (err) {
            console.warn("OPFS sync error:", err);
        }
    }

    // Background restore from OPFS
    async function loadFromOPFS() {
        if (!navigator.storage || !navigator.storage.getDirectory) return;
        try {
            const root = await navigator.storage.getDirectory();
            
            async function scanDir(dirHandle, currentVirtualPath) {
                for await (const entry of dirHandle.values()) {
                    if (entry.kind === 'file') {
                        const file = await entry.getFile();
                        const text = await file.text();
                        const virtualFilePath = currentVirtualPath + "\\" + entry.name;
                        
                        if (!(virtualFilePath in files)) {
                            files[virtualFilePath] = text;
                            let parent = currentVirtualPath;
                            while (parent) {
                                directories.add(parent);
                                parent = getParentOf(parent);
                            }
                        }
                    } else if (entry.kind === 'directory') {
                        const virtualDirPath = currentVirtualPath + "\\" + entry.name;
                        directories.add(virtualDirPath);
                        await scanDir(entry, virtualDirPath);
                    }
                }
            }
            
            await scanDir(root, "C:\\");
            
            // Update localStorage
            localStorage.setItem("__OPFS_VIRTUAL_FS__", JSON.stringify({
                files: files,
                directories: Array.from(directories)
            }));
        } catch (err) {
            console.warn("OPFS restore error:", err);
        }
    }

    function persistFS() {
        var data = {
            files: files,
            directories: Array.from(directories)
        };
        try {
            localStorage.setItem("__OPFS_VIRTUAL_FS__", JSON.stringify(data));
        } catch (e) {
            console.error("Failed to write to localStorage:", e);
        }
        // Async save to Origin Private File System
        saveToOPFS(data);
    }

    // Load VFS State immediately so MockXHR can use it synchronously
    loadFS();

    // Determine if core classes are already loaded. If so, run synchronously
    // to prevent builder-level instantiation failures. Otherwise, poll.
    if (window.jsx3 && jsx3.Class && jsx3.net && jsx3.net.Request && jsx3.io && jsx3.io.FileRequest) {
        defineOPFSClasses();
    } else {
        var pollInterval = setInterval(function() {
            if (window.jsx3 && jsx3.Class && jsx3.net && jsx3.net.Request && jsx3.io && jsx3.io.FileRequest) {
                clearInterval(pollInterval);
                defineOPFSClasses();
            }
        }, 50);
    }

    function defineOPFSClasses() {
        try {
            // Define OPFSFileSystem Class
            jsx3.Class.defineClass("jsx3.io.OPFSFileSystem", jsx3.io.FileSystem, null, function(i, b) {
                b.getFile = function(d) {
                    if (typeof d == "string" && d.match(/^[a-zA-Z]:\\/)) {
                        d = "file:///" + d.replace(/\\/g, "/");
                    }
                    var uri = jsx3.net.URI.valueOf(d);
                    if (!uri.getScheme()) {
                        uri = new jsx3.net.URI("file://" + (uri.getPath().indexOf("/") != 0 ? "/" : "") + uri.getPath());
                    }
                    return new jsx3.io.OPFSFile(this, uri);
                };

                b.getUserDocuments = function() {
                    return this.getFile("C:\\projects");
                };

                b.getRoots = function() {
                    return [this.getFile("C:\\")];
                };

                b.createTempFile = function(prefix) {
                    var name = "temp_" + Math.random().toString(36).substring(2, 10) + ".txt";
                    var file = this.getFile("C:\\projects\\" + name);
                    file.write("");
                    return file;
                };
            });

            // Define OPFSFile Class
            jsx3.Class.defineClass("jsx3.io.OPFSFile", jsx3.io.File, null, function(e, s) {
                s.nM = null;

                s.init = function(fs, uri) {
                    this.jsxsuper(fs, uri);
                    if (uri != null) {
                        var path = uri.isAbsolute() && uri.getPath() ? uri.getPath().substring(1) : uri.getPath();
                        this.nM = normalizePath(path);
                    } else {
                        this._uri = null;
                    }
                };

                s.getPath = function() {
                    return this.nM;
                };

                s.getAbsolutePath = function() {
                    return this.nM;
                };

                s.getName = function() {
                    var path = this.getPath();
                    if (path === "C:\\") return "C:\\";
                    var idx = path.lastIndexOf("\\");
                    return idx >= 0 ? path.substring(idx + 1) : path;
                };

                s.exists = function() {
                    var path = this.getPath();
                    return (path in files) || directories.has(path);
                };

                s.isFile = function() {
                    return (this.getPath() in files);
                };

                s.isDirectory = function() {
                    return directories.has(this.getPath());
                };

                s.read = function() {
                    return files[this.getPath()] || "";
                };

                s.write = function(content) {
                    var path = this.getPath();
                    files[path] = content;
                    
                    var parent = this.getParentPath();
                    while (parent) {
                        directories.add(parent);
                        parent = getParentOf(parent);
                    }
                    
                    persistFS();
                    return true;
                };

                s.mkdir = function() {
                    var path = this.getPath();
                    directories.add(path);
                    
                    var parent = this.getParentPath();
                    while (parent) {
                        directories.add(parent);
                        parent = getParentOf(parent);
                    }
                    persistFS();
                };

                s.deleteFile = function() {
                    var path = this.getPath();
                    if (path in files) {
                        delete files[path];
                    } else if (directories.has(path)) {
                        directories.delete(path);
                        
                        // Recursive delete files
                        for (var f in files) {
                            if (f.indexOf(path + "\\") === 0) {
                                delete files[f];
                            }
                        }
                        // Recursive delete folders
                        directories.forEach(function(d) {
                            if (d.indexOf(path + "\\") === 0) {
                                directories.delete(d);
                            }
                        });
                    }
                    persistFS();
                };

                s.renameTo = function(destFile) {
                    var src = this.getPath();
                    var dest = destFile.getPath();
                    
                    if (src in files) {
                        files[dest] = files[src];
                        delete files[src];
                    } else if (directories.has(src)) {
                        directories.delete(src);
                        directories.add(dest);
                        
                        for (var f in files) {
                            if (f.indexOf(src + "\\") === 0) {
                                var newKey = dest + f.substring(src.length);
                                files[newKey] = files[f];
                                delete files[f];
                            }
                        }
                        directories.forEach(function(d) {
                            if (d.indexOf(src + "\\") === 0) {
                                var newKey = dest + d.substring(src.length);
                                directories.add(newKey);
                                directories.delete(d);
                            }
                        });
                    }
                    persistFS();
                };

                s.getParentPath = function() {
                    var path = this.getPath();
                    return getParentOf(path);
                };

                s.listFiles = function() {
                    var me = this;
                    var path = this.getPath();
                    var children = [];
                    var seen = {};

                    for (var f in files) {
                        var parent = getParentOf(f);
                        if (parent === path && !seen[f]) {
                            seen[f] = true;
                            children.push(new jsx3.io.OPFSFile(me.getFileSystem(), pathToURI(f, false)));
                        }
                    }

                    directories.forEach(function(d) {
                        var parent = getParentOf(d);
                        if (parent === path && d !== path && !seen[d]) {
                            seen[d] = true;
                            children.push(new jsx3.io.OPFSFile(me.getFileSystem(), pathToURI(d, true)));
                        }
                    });

                    return children;
                };

                s.isHidden = function() { return false; };
                s.isReadOnly = function() { return false; };
                s.setReadOnly = function(d) {};
                s.isRoot = function() {
                    return this.getPath() === "C:\\";
                };
                s.getType = function() {
                    return this.isDirectory() ? "Folder" : "File";
                };
                s.getStat = function() {
                    if (this.exists()) {
                        return {
                            mtime: new Date(),
                            size: this.isFile() ? (files[this.getPath()] || "").length : 0
                        };
                    }
                    return null;
                };

                s.toURI = function() {
                    return pathToURI(this.getPath(), this.isDirectory());
                };
            });

            // Register FileRequest handler for file scheme in modern browsers!
            jsx3.net.Request.addSchemeHandler("file", jsx3.io.FileRequest.jsxclass);
            console.log("[SHELL-OPFS] Registered OPFS file scheme request handler.");

            // Override the ClassLoader's asynchronous script loader method loadJSFile
            if (jsx3.CLASS_LOADER) {
                var originalLoadJSFile = jsx3.CLASS_LOADER.loadJSFile;
                jsx3.CLASS_LOADER.loadJSFile = function(j, s) {
                    if (j && j.indexOf("file:") === 0) {
                        console.log("[XHR-SCRIPT-LOAD] Intercepting loadJSFile for local script: " + j);
                        var req = jsx3.net.Request.open("GET", j, true);
                        req.subscribe(jsx3.net.Request.ON_RESPONSE, function() {
                            if (req.getStatus() === 200) {
                                try {
                                    jsx3.eval(req.getResponseText());
                                    if (s) s(j);
                                } catch (e) {
                                    console.error("[XHR-SCRIPT-LOAD] Eval failed for " + j + ": " + e.message);
                                }
                            } else {
                                    console.error("[XHR-SCRIPT-LOAD] Failed to load local script " + j + " (status: " + req.getStatus() + ")");
                            }
                        });
                        req.send();
                    } else {
                        originalLoadJSFile.call(this, j, s);
                    }
                };
                console.log("[XHR-SCRIPT-LOAD] Overrode ClassLoader.loadJSFile to support virtual file scripts.");
            }
        } catch (e) {
            console.error("[SHELL-OPFS] Error inside defineOPFSClasses: " + e.message);
        }
    }
})();
