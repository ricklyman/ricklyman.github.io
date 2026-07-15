/*
 * Copyright (c) 2001-2011, TIBCO Software Inc.
 * Use, modification, and distribution subject to terms of license.
 */

(function() {
    var resolveReady;
    window.__VFS_READY__ = window.__VFS_READY__ || {};
    window.__VFS_READY__["opfs"] = new Promise(function(resolve) {
        resolveReady = resolve;
    });

    // Virtual File System State
    var files = {};
    window.__VFS_FILES__ = window.__VFS_FILES__ || {};
    window.__VFS_FILES__["opfs"] = files;
    var directories = new Set();

    function hasFile(path) {
        if (!path) return false;
        var pathLower = path.toLowerCase();
        return Object.keys(files).some(function(k) { return k.toLowerCase() === pathLower; });
    }
    
    function getFileContent(path) {
        if (!path) return undefined;
        var pathLower = path.toLowerCase();
        var matched = Object.keys(files).find(function(k) { return k.toLowerCase() === pathLower; });
        return matched ? files[matched] : undefined;
    }
    
    function setFileContent(path, content) {
        if (!path) return;
        var pathLower = path.toLowerCase();
        var matched = Object.keys(files).find(function(k) { return k.toLowerCase() === pathLower; });
        if (matched) {
            files[matched] = content;
        } else {
            files[path] = content;
        }
    }
    
    function hasDirectory(path) {
        if (!path) return false;
        var pathLower = path.toLowerCase();
        var dirs = Array.from(directories);
        return dirs.some(function(k) { return k.toLowerCase() === pathLower; });
    }

    function normalizePath(path) {
        if (!path) return "";
        path = path.replace(/\//g, "\\");
        if (path.endsWith("\\") && path.length > 3) {
            path = path.substring(0, path.length - 1);
        }
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
        var actualIsDir = isDir || (directories && directories.has(path)) || !path.substring(path.lastIndexOf("\\") + 1).includes(".");
        if (actualIsDir && !p.endsWith("/")) {
            p += "/";
        }
        if (!p.startsWith("/")) p = "/" + p;
        return jsx3.net.URI.valueOf("file://" + p);
    }

    // Load VFS Cache synchronously from localStorage for early boot requests
    function loadFS() {
        try {
            var raw = localStorage.getItem("__OPFS_VIRTUAL_FS__");
            if (raw) {
                if (raw.length > 200000) {
                    localStorage.removeItem("__OPFS_VIRTUAL_FS__");
                    console.warn("[OPFS-VFS] Cleared old massive VFS cache to free up localStorage space.");
                    raw = null;
                }
            }
            if (raw) {
                var data = JSON.parse(raw);
                files = data.files || {};
                directories = new Set(data.directories || []);
                if (directories.size === 0) {
                    directories.add("C:\\");
                    directories.add("C:\\projects");
                    directories.add("C:\\projects\\TibcoGI");
                }
                loadFromOPFS();
                return;
            }
        } catch (e) {
            console.error("Failed to load OPFS VFS cache from localStorage:", e);
        }
        files = {};
        directories = new Set(["C:\\", "C:\\projects"]);
        loadFromOPFS();
    }

    function persistFS() {
        // Optimize cache: only store small boot configuration XMLs in localStorage (e.g. builder.xml, logger.xml, config.xml)
        // to prevent QuotaExceededError (localStorage is capped at 5MB).
        var smallFiles = {};
        for (var f in files) {
            if (f.endsWith(".xml") && (f.indexOf("settings\\") >= 0 || f.endsWith("config.xml"))) {
                smallFiles[f] = files[f];
            }
        }
        var data = {
            files: smallFiles,
            directories: Array.from(directories)
        };
        try {
            localStorage.setItem("__OPFS_VIRTUAL_FS__", JSON.stringify(data));
        } catch (e) {
            console.warn("[OPFS-VFS] Failed to write VFS cache to localStorage (ignoring):", e);
        }
        saveToOPFS({ files: files, directories: Array.from(directories) });
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
                for (let i = 0; i < parts.length - 1; i++) {
                    let part = parts[i];
                    if (part.endsWith(":")) part = part.slice(0, -1);
                    dirHandle = await dirHandle.getDirectoryHandle(part, { create: true });
                }
                const fileName = parts[parts.length - 1];
                const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(content);
                await writable.close();
            }
        } catch (err) {
            console.warn("[OPFS-SYNC] Sync error:", err);
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
                        var virtualFilePath = currentVirtualPath;
                        if (virtualFilePath.endsWith("\\")) {
                            virtualFilePath += entry.name;
                        } else {
                            virtualFilePath += (virtualFilePath ? "\\" : "") + entry.name;
                        }
                        
                        if (!(virtualFilePath in files)) {
                            files[virtualFilePath] = text;
                            let parent = getParentOf(virtualFilePath);
                            while (parent) {
                                directories.add(parent);
                                parent = getParentOf(parent);
                            }
                        }
                    } else if (entry.kind === 'directory') {
                        var virtualDirPath = currentVirtualPath;
                        if (currentVirtualPath === "") {
                            if (entry.name === "C") {
                                virtualDirPath = "C:\\";
                            } else {
                                virtualDirPath = entry.name;
                            }
                        } else {
                            if (virtualDirPath.endsWith("\\")) {
                                virtualDirPath += entry.name;
                            } else {
                                virtualDirPath += "\\" + entry.name;
                            }
                        }
                        directories.add(virtualDirPath);
                        await scanDir(entry, virtualDirPath);
                    }
                }
            }
            await scanDir(root, "");
            var smallFiles = {};
            for (var f in files) {
                if (f.endsWith(".xml") && (f.indexOf("settings\\") >= 0 || f.endsWith("config.xml"))) {
                    smallFiles[f] = files[f];
                }
            }
            localStorage.setItem("__OPFS_VIRTUAL_FS__", JSON.stringify({
                files: smallFiles,
                directories: Array.from(directories)
            }));
        } catch (err) {
            console.warn("[OPFS-SYNC] Restore error:", err);
        }
    }

    // Load VFS Cache synchronously at startup
    loadFS();

    // Determine if core classes are already loaded. If so, run synchronously.
    // Otherwise, poll for core classloader classes.
    if (window.jsx3 && jsx3.Class && jsx3.net && jsx3.net.Request) {
        defineOPFSClasses();
    } else {
        var pollInterval = setInterval(function() {
            if (window.jsx3 && jsx3.Class && jsx3.net && jsx3.net.Request) {
                clearInterval(pollInterval);
                defineOPFSClasses();
            }
        }, 50);
    }

    function defineOPFSClasses() {
        try {
            if (window.jsx3 && jsx3.ide) {
                jsx3.ide._CURRENT_USER_HOME = null;
            }
            window.jsx3.io = window.jsx3.io || {};

            // 1. Self-bootstrap base classes if running in standalone shell context
            if (!jsx3.io.FileSystem) {
                jsx3.Class.defineClass("jsx3.io.FileSystem", null, null, function(a, j) {
                    var ub = {a: "strPath"};
                    j.getFile = jsx3.Method.newAbstract(ub.a);
                    j.getUserDocuments = jsx3.Method.newAbstract();
                    j.getRoots = jsx3.Method.newAbstract();
                    j.createTempFile = jsx3.Method.newAbstract();
                });
            }

            if (!jsx3.io.File) {
                jsx3.Class.defineClass("jsx3.io.File", null, null, function(j, m) {
                    var ub = {a: "\r\n", b: "\r", c: "\n", d: "Not implemented", e: "/", f: "", g: "..", h: ".", i: "May not resolve an absolute path: "};
                    j.FIND_INCLUDE = 1;
                    j.FIND_RECURSE = 2;
                    j.LINE_SEP = {dos: ub.a, mac: ub.b, unix: ub.c};
                    
                    m.init = function(s, d) {
                        this._fs = s;
                        this._uri = jsx3.net.URI.valueOf(d);
                    };
                    
                    m.getFileSystem = function() { return this._fs; };
                    m.write = function(h, i) { throw new jsx3.Exception(ub.d); };
                    m.read = function() { throw new jsx3.Exception(ub.d); };
                    m.isDirectory = function() { return false; };
                    m.isFile = function() { return false; };
                    
                    m.getParentFile = function() {
                        var Ka = this.toURI();
                        var bb = Ka.getPath();
                        if (bb == ub.e || bb == ub.f) return null;
                        if (this.isDirectory() && (jsx3.$S(bb)).endsWith(ub.e)) {
                            Ka = Ka.resolve(ub.g);
                        } else Ka = Ka.resolve(ub.h);
                        var pa = this._fs.getFile(Ka);
                        return this.equals(pa) ? null : pa;
                    };
                    
                    m.resolve = function(c) {
                        c = jsx3.net.URI.valueOf(c);
                        if (c.isAbsolute()) throw new jsx3.Exception(ub.i + c);
                        return this._fs.getFile((this.toURI()).resolve(c));
                    };
                    
                    m.getParentPath = function() {
                        var kb = this.getParentFile();
                        return kb != null ? kb.getAbsolutePath() : null;
                    };
                    
                    m.listFiles = function() { return jsx3.$A(); };
                    m.mkdir = function() { throw new jsx3.Exception(ub.d); };
                    
                    m.mkdirs = function() {
                        var x = this.getParentFile();
                        if (x) x.mkdirs();
                        if (!this.isDirectory()) this.mkdir();
                    };
                    
                    m.deleteFile = function() { throw new jsx3.Exception(ub.d); };
                    m.getAbsolutePath = function() { return (this.toURI()).getPath(); };
                    
                    m.getName = function() {
                        var t = (this.toURI()).getPath();
                        var qb = t.lastIndexOf(ub.e);
                        if (qb == t.length - 1) {
                            qb = t.lastIndexOf(ub.e, qb - 1);
                            return t.substring(qb >= 0 ? qb + 1 : 0, t.length - 1);
                        } else return qb >= 0 ? t.substring(qb + 1) : t;
                    };
                    
                    m.getExtension = function() {
                        var Na = this.getName();
                        if (Na) {
                            var Z = Na.lastIndexOf(ub.h);
                            if (Z >= 0) return Na.substring(Z + 1);
                        }
                        return ub.f;
                    };
                    
                    m.exists = function() { return this.isFile() || this.isDirectory(); };
                    m.renameTo = function(r) { throw new jsx3.Exception(ub.d); };
                    
                    m.copyTo = function(i) {
                        if (this.isFile()) {
                            i.write(this.read());
                        } else if (this.isDirectory()) {
                            i.mkdir();
                            jsx3.$A(this.listFiles()).each(function(c) {
                                c.copyTo(i.resolve(c.getName()));
                            });
                        }
                    };
                    
                    m.isHidden = function() { return false; };
                    m.isReadOnly = function() { return false; };
                    m.setReadOnly = function(h) { throw new jsx3.Exception(ub.d); };
                    m.isRoot = function() { return this.getParentFile() == null; };
                    m.getType = function() { return this.getExtension(); };
                    m.getStat = function() { return {mtime: null, size: null}; };
                    
                    m.equals = function(d) {
                        if (d && d.toURI) {
                            var K = this.toURI();
                            var Sa = d.toURI();
                            if (K.getScheme() == Sa.getScheme() && K.getPath() == Sa.getPath() && K.getQuery() == Sa.getQuery()) {
                                var C = K.getAuthority() || ub.f;
                                var R = Sa.getAuthority() || ub.f;
                                return C == R;
                            }
                        }
                        return false;
                    };
                    
                    m.isDescendantOf = function(e) {
                        var J = e.toURI();
                        var A = this.toURI();
                        if (J.getScheme() != A.getScheme()) return false;
                        if ((J.getAuthority() || ub.f) != (A.getAuthority() || ub.f)) return false;
                        var Ma = J.getPath();
                        var t = A.getPath();
                        return t.length > Ma.length && t.indexOf(Ma) == 0 && (t.charAt(Ma.length) == ub.e || t.charAt(Ma.length - 1) == ub.e);
                    };
                    
                    m.relativePathTo = function(i) {
                        return ((this.toURI()).relativize(i.toURI())).toString();
                    };
                    
                    j.WW = function(k) { return j.FIND_INCLUDE | j.FIND_RECURSE; };
                    
                    m.find = function(h, f, o) {
                        if (o == null) o = [];
                        if (!h) h = j.WW;
                        var Ya = this.listFiles();
                        for (var jb = 0; jb < Ya.length; jb++) {
                            var pb = h.call(null, Ya[jb]);
                            if ((pb & j.FIND_INCLUDE) > 0) o.push(Ya[jb]);
                            if (f && Ya[jb].isDirectory() && (pb & j.FIND_RECURSE) > 0) Ya[jb].find(h, f, o);
                        }
                        return jsx3.$A(o);
                    };
                    
                    m.toURI = function() { return this._uri; };
                    
                    m.getRootDirectory = function() {
                        var db = this;
                        while (true) {
                            var _ = db.getParentFile();
                            if (!_) {
                                if (db.isDirectory()) return db;
                                else return null;
                            } else db = _;
                        }
                    };
                    
                    m.toString = function() { return this.getAbsolutePath(); };
                });
            }

            if (!jsx3.io.FileRequest) {
                jsx3.Class.defineClass("jsx3.io.FileRequest", jsx3.net.Request, null, function(c, q) {
                    q.open = function(m, k, s, a, o) {
                        this._url = jsx3.net.URIResolver.DEFAULT.resolveURI(k);
                        this._async = s;
                        return this;
                    };
                    
                    q.send = function(j, s) {
                        var urlStr = this._url ? this._url.toString() : "unknown";
                        console.log("[FileRequest] send() called for: " + urlStr + " (async: " + this._async + ")");
                        var W = jsx3.io.PLUGIN.getFileForURI(this._url);
                        if (W && W.isFile()) {
                            this._response = W.read();
                            this._status = 200;
                            console.log("[FileRequest] Read success from VFS cache. Content length: " + (this._response ? this._response.length : 0));
                        } else {
                            this._status = jsx3.net.Request.STATUS_ERROR;
                            console.warn("[FileRequest] File not found or is not a file in VFS: " + urlStr);
                        }
                        if (this._async) {
                            var me = this;
                            console.log("[FileRequest] Queueing async EVENT_ON_RESPONSE event callback via setTimeout for: " + urlStr);
                            setTimeout(function() {
                                console.log("[FileRequest] Dispatching EVENT_ON_RESPONSE event via setTimeout for: " + urlStr);
                                me.publish({subject: jsx3.net.Request.EVENT_ON_RESPONSE});
                            }, 0);
                        } else {
                            console.log("[FileRequest] Sync send() completed for: " + urlStr);
                        }
                        return this;
                    };
                    
                    q.getURL = function() { return this._url && this._url.toString(); };
                    q.getStatus = function() { return this._status || 200; };
                    q.getResponseText = function() { return this._response; };
                    q.getResponseXML = function() { return (new jsx3.xml.Document()).loadXML(this.getResponseText()); };
                });
            }

            // 2. Define OPFSFileSystem Class first
            if (!jsx3.Class.forName("jsx3.io.OPFSFileSystem")) {
                jsx3.Class.defineClass("jsx3.io.OPFSFileSystem", jsx3.io.FileSystem, null, function(i, b) {
                    b.getId = function() { return "opfs"; };
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
            }

            // Define OPFSFile Class
            if (!jsx3.Class.forName("jsx3.io.OPFSFile")) {
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
                        return hasFile(path) || hasDirectory(path);
                    };

                    s.isFile = function() {
                        return hasFile(this.getPath());
                    };

                    s.isDirectory = function() {
                        return hasDirectory(this.getPath());
                    };

                    s.read = function() {
                        return getFileContent(this.getPath()) || "";
                    };

                    s.write = function(content) {
                        var path = this.getPath();
                        setFileContent(path, content);
                        
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
                            for (var f in files) {
                                if (f.indexOf(path + "\\") === 0) {
                                    delete files[f];
                                }
                            }
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
                        var pathLower = path.toLowerCase();
                        var children = [];
                        var seen = {};

                        for (var f in files) {
                            var parent = getParentOf(f);
                            if (parent && parent.toLowerCase() === pathLower && !seen[f.toLowerCase()]) {
                                seen[f.toLowerCase()] = true;
                                children.push(new jsx3.io.OPFSFile(me.getFileSystem(), pathToURI(f, false)));
                            }
                        }

                        directories.forEach(function(d) {
                            var parent = getParentOf(d);
                            if (parent && parent.toLowerCase() === pathLower && d.toLowerCase() !== pathLower && !seen[d.toLowerCase()]) {
                                seen[d.toLowerCase()] = true;
                                children.push(new jsx3.io.OPFSFile(me.getFileSystem(), pathToURI(d, true)));
                            }
                        });

                        return children;
                    };

                    s.isHidden = function() { return false; };
                    s.isReadOnly = function() { return false; };
                    s.setReadOnly = function(d) {};
                    s.isRoot = function() { return this.getPath() === "C:\\"; };
                    s.getType = function() { return this.isDirectory() ? "Folder" : "File"; };
                    s.getStat = function() {
                        if (this.exists()) {
                            return {
                                mtime: new Date(),
                                size: this.isFile() ? (files[this.getPath()] || "").length : 0
                            };
                        }
                        return null;
                    };

                    s.toURI = function() { return pathToURI(this.getPath(), this.isDirectory()); };
                });
            }

            // 3. Register the filesystem instance in our mocked plugin now that classes are fully defined
            if (!jsx3.io.PLUGIN) {
                jsx3.io.PLUGIN = {
                    _fss: [],
                    getAvailableFileSystems: function() { return this._fss; },
                    getFileSystemsForURI: function(objURI) {
                        var objURI = jsx3.net.URI.valueOf(objURI);
                        return jsx3.$A(this._fss).filter(function (fs) {
                            return jsx3.$A(fs.getSchemes()).contains(objURI.getScheme());
                        });
                    },
                    getFileForURI: function(objURI) {
                        var fs = this.getFileSystemsForURI(objURI);
                        var fsw = fs.filter(function(e) { return e.hasWrite(); });
                        if (fsw.length == 0) fsw = fs;
                        if (fsw.length > 0)
                            return fsw[0].getInstance().getFile(objURI);
                        return null;
                    }
                };

                var fsDesc = {
                    _inst: new jsx3.io.OPFSFileSystem(),
                    getId: function() { return "opfs"; },
                    getSchemes: function() { return ["file"]; },
                    hasWrite: function() { return true; },
                    getInstance: function() { return this._inst; }
                };
                fsDesc._inst._desc = fsDesc;
                jsx3.io.PLUGIN._fss.push(fsDesc);
            }

            var isRunner = window.location.pathname.indexOf("shell.html") >= 0;

            // Register FileRequest handler for file scheme in modern browsers (Builder only)!
            if (!isRunner && jsx3.net.Request && jsx3.io.FileRequest) {
                jsx3.net.Request.addSchemeHandler("file", jsx3.io.FileRequest.jsxclass);
                console.log("[SHELL-OPFS] Registered OPFS file scheme request handler.");
            }

            // Override ClassLoader's asynchronous script loader method loadJSFile
            if (jsx3.CLASS_LOADER) {
                var originalLoadJSFile = jsx3.CLASS_LOADER.loadJSFile;
                jsx3.CLASS_LOADER.loadJSFile = function(j, s) {
                    var urlStr = (j && typeof j.toString === "function") ? j.toString() : String(j);
                    if (urlStr && urlStr.indexOf("file:") === 0) {
                        var activeFsId = localStorage.getItem("__ACTIVE_FILESYSTEM_ID__") || "opfs";
                        var cacheKey = activeFsId === "local" ? "__LOCAL_VIRTUAL_FS__" : "__OPFS_VIRTUAL_FS__";
                        console.log("[XHR-SCRIPT-LOAD] Intercepting loadJSFile for local script: " + urlStr + " using VFS: " + activeFsId);
                        var req = jsx3.net.Request.open("GET", urlStr, true);
                        console.log("[XHR-SCRIPT-LOAD] Subscribing to EVENT_ON_RESPONSE for: " + urlStr);
                        req.subscribe(jsx3.net.Request.EVENT_ON_RESPONSE, function() {
                            console.log("[XHR-SCRIPT-LOAD] ON_RESPONSE event triggered for: " + urlStr + " (Status: " + req.getStatus() + ")");
                            if (req.getStatus() === 200) {
                                try {
                                    console.log("[XHR-SCRIPT-LOAD] Evaluating script content for: " + urlStr);
                                    jsx3.eval(req.getResponseText());
                                    console.log("[XHR-SCRIPT-LOAD] Evaluation successful. Calling ClassLoader callback for: " + urlStr);
                                    if (s) s(j);
                                } catch (e) {
                                    console.error("[XHR-SCRIPT-LOAD] Eval failed for " + urlStr + ": " + e.message);
                                }
                            } else {
                                console.error("[XHR-SCRIPT-LOAD] Failed to load local script " + urlStr + " (status: " + req.getStatus() + ")");
                            }
                        });
                        console.log("[XHR-SCRIPT-LOAD] Calling req.send() for: " + urlStr);
                        req.send();
                        console.log("[XHR-SCRIPT-LOAD] req.send() completed for: " + urlStr);
                    } else {
                        originalLoadJSFile.call(this, j, s);
                    }
                };
                console.log("[XHR-SCRIPT-LOAD] Overrode ClassLoader.loadJSFile to support virtual file scripts.");
            }

            // Unified Active File System override for getFileForURI (Strict file:// scheme check)
            if (jsx3.io.PLUGIN) {
                var originalGetFileForURI = jsx3.io.PLUGIN.getFileForURI;
                jsx3.io.PLUGIN.getFileForURI = function(objURI) {
                    var uri = jsx3.net.URI.valueOf(objURI);
                    if (uri && uri.getScheme() === "file") {
                        var activeFsId = localStorage.getItem("__ACTIVE_FILESYSTEM_ID__") || "opfs";
                        var fs = this.getAvailableFileSystems().find(function(e) { return e.getId() === activeFsId; });
                        if (fs) {
                            return fs.getInstance().getFile(uri);
                        }
                    }
                    return originalGetFileForURI.call(this, objURI);
                };
            }
            if (typeof resolveReady === "function") resolveReady();
        } catch (e) {
            console.error("[SHELL-OPFS] Error inside defineOPFSClasses: " + e.message);
            if (typeof resolveReady === "function") resolveReady();
        }
    }
})();
