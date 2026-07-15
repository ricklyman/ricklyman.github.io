/*
 * Copyright (c) 2001-2011, TIBCO Software Inc.
 * Use, modification, and distribution subject to terms of license.
 */

(function() {
    var resolveReady;
    window.__VFS_READY__ = window.__VFS_READY__ || {};
    window.__VFS_READY__["local"] = new Promise(function(resolve) {
        resolveReady = resolve;
    });

    // Virtual File System State
    var files = {};
    window.__VFS_FILES__ = window.__VFS_FILES__ || {};
    window.__VFS_FILES__["local"] = files;
    var directories = new Set();
    var rootHandle = null;

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
            var raw = localStorage.getItem("__LOCAL_VIRTUAL_FS__");
            if (raw) {
                if (raw.length > 200000) {
                    localStorage.removeItem("__LOCAL_VIRTUAL_FS__");
                    console.warn("[LOCAL-VFS] Cleared old massive VFS cache to free up localStorage space.");
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
                return;
            }
        } catch (e) {
            console.error("Failed to load local VFS cache from localStorage:", e);
        }
        files = {};
        directories = new Set(["C:\\", "C:\\projects", "C:\\projects\\TibcoGI"]);
    }

    function persistFS() {
        // Optimize cache: only store small boot configuration XMLs in localStorage (e.g. builder.xml, logger.xml, config.xml)
        // to prevent QuotaExceededError (localStorage is capped at 5MB). Large scripts are loaded asynchronously anyway.
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
            localStorage.setItem("__LOCAL_VIRTUAL_FS__", JSON.stringify(data));
        } catch (e) {
            console.warn("[LOCAL-VFS] Failed to write VFS cache to localStorage (ignoring):", e);
        }
    }

    // IndexedDB helpers to persist DirectoryHandle
    function openDB() {
        return new Promise(function(resolve, reject) {
            var request = indexedDB.open("LocalDiskVFS_DB", 1);
            request.onupgradeneeded = function(e) {
                var db = e.target.result;
                db.createObjectStore("handles");
            };
            request.onsuccess = function(e) {
                resolve(e.target.result);
            };
            request.onerror = function(e) {
                reject(e.target.error);
            };
        });
    }

    function storeHandle(handle) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction("handles", "readwrite");
                var store = tx.objectStore("handles");
                var req = store.put(handle, "project_root");
                req.onsuccess = function() { resolve(); };
                req.onerror = function(e) { reject(e.target.error); };
            });
        });
    }

    // Retrieves DirectoryHandle from IndexedDB
    function retrieveHandle() {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction("handles", "readonly");
                var store = tx.objectStore("handles");
                var req = store.get("project_root");
                req.onsuccess = function(e) { resolve(e.target.result); };
                req.onerror = function(e) { reject(e.target.error); };
            });
        });
    }

    // Asynchronous background file writer to local drive
    async function writeLocalFile(path, content) {
        if (!rootHandle) return;
        try {
            var relativePath = path;
            if (path.toLowerCase().indexOf("c:\\projects\\tibcogi") === 0) {
                relativePath = path.substring(19);
            }
            var parts = relativePath.split("\\").filter(Boolean);
            if (parts.length === 0) return;
            
            let dirHandle = rootHandle;
            for (let i = 0; i < parts.length - 1; i++) {
                dirHandle = await dirHandle.getDirectoryHandle(parts[i], { create: true });
            }
            const fileName = parts[parts.length - 1];
            const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            console.log("[LOCAL-VFS] Successfully synced file to disk: " + path);
        } catch (err) {
            console.error("[LOCAL-VFS] Error syncing file to disk: " + path, err);
        }
    }

    // Asynchronous background directory creator
    async function makeLocalDir(path) {
        if (!rootHandle) return;
        try {
            var relativePath = path;
            if (path.toLowerCase().indexOf("c:\\projects\\tibcogi") === 0) {
                relativePath = path.substring(19);
            }
            var parts = relativePath.split("\\").filter(Boolean);
            if (parts.length === 0) return;
            
            let dirHandle = rootHandle;
            for (let i = 0; i < parts.length; i++) {
                dirHandle = await dirHandle.getDirectoryHandle(parts[i], { create: true });
            }
            console.log("[LOCAL-VFS] Successfully synced directory to disk: " + path);
        } catch (err) {
            console.error("[LOCAL-VFS] Error syncing directory to disk: " + path, err);
        }
    }

    // Asynchronous background file/directory deleter
    async function deleteLocalFile(path) {
        if (!rootHandle) return;
        try {
            var relativePath = path;
            if (path.toLowerCase().indexOf("c:\\projects\\tibcogi") === 0) {
                relativePath = path.substring(19);
            }
            var parts = relativePath.split("\\").filter(Boolean);
            if (parts.length === 0) return;
            
            let dirHandle = rootHandle;
            for (let i = 0; i < parts.length - 1; i++) {
                dirHandle = await dirHandle.getDirectoryHandle(parts[i]);
            }
            const name = parts[parts.length - 1];
            await dirHandle.removeEntry(name, { recursive: true });
            console.log("[LOCAL-VFS] Successfully deleted from disk: " + path);
        } catch (err) {
            console.error("[LOCAL-VFS] Error deleting from disk: " + path, err);
        }
    }

    // Crawls the DirectoryHandle recursively and populates VFS cache
    async function initializeVFS(handle) {
        rootHandle = handle;
        directories = new Set([
            "C:\\",
            "C:\\projects",
            "C:\\projects\\TibcoGI"
        ]);
        
        async function scan(dirHandle, currentVirtualPath) {
            for await (const entry of dirHandle.values()) {
                var virtualPath = currentVirtualPath + "\\" + entry.name;
                if (entry.kind === 'file') {
                    const file = await entry.getFile();
                    const text = await file.text();
                    files[virtualPath] = text;
                } else if (entry.kind === 'directory') {
                    directories.add(virtualPath);
                    await scan(entry, virtualPath);
                }
            }
        }
        
        try {
            await scan(handle, "C:\\projects\\TibcoGI");
            console.log("[LOCAL-VFS] Directory scan complete. Loaded " + Object.keys(files).length + " files.");
            persistFS();
            defineLocalClasses();
            if (typeof resolveReady === "function") resolveReady();
        } catch (err) {
            console.error("[LOCAL-VFS] Crawl failed: ", err);
            if (typeof resolveReady === "function") resolveReady();
        }
    }

    async function createPhysicalDirectory(virtualPath) {
        if (!rootHandle) return;
        try {
            var relativePath = virtualPath;
            if (virtualPath.toLowerCase().indexOf("c:\\projects\\tibcogi") === 0) {
                relativePath = virtualPath.substring(19);
            }
            var parts = relativePath.split("\\").filter(Boolean);
            if (parts.length === 0) return;
            
            let dirHandle = rootHandle;
            for (let i = 0; i < parts.length; i++) {
                dirHandle = await dirHandle.getDirectoryHandle(parts[i], { create: true });
            }
            console.log("[LOCAL-VFS] Physical directory created: " + virtualPath);
        } catch (err) {
            console.error("[LOCAL-VFS] mkdir failed: ", err);
        }
    }

    // Modern Secure UI overlay for permission gesture
    function showPermissionOverlay(isSelection, originError) {
        var overlay = document.getElementById("local-disk-permission-overlay");
        if (overlay) return;
        
        overlay = document.createElement("div");
        overlay.id = "local-disk-permission-overlay";
        overlay.style.position = "fixed";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100%";
        overlay.style.height = "100%";
        overlay.style.backgroundColor = "rgba(17, 18, 24, 0.98)";
        overlay.style.zIndex = "1000000";
        overlay.style.display = "flex";
        overlay.style.flexDirection = "column";
        overlay.style.justifyContent = "center";
        overlay.style.alignItems = "center";
        overlay.style.fontFamily = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
        overlay.style.color = "#e3e6ed";
        
        var card = document.createElement("div");
        card.style.backgroundColor = "#111218";
        card.style.border = "1px solid #272c3d";
        card.style.borderRadius = "12px";
        card.style.padding = "40px";
        card.style.maxWidth = "480px";
        card.style.textAlign = "center";
        card.style.boxShadow = "0 8px 32px rgba(0,0,0,0.5)";
        
        var title = document.createElement("h2");
        title.style.marginTop = "0";
        title.style.color = "#9d4edd";
        title.style.fontSize = "22px";
        title.style.letterSpacing = "0.5px";
        title.textContent = originError 
            ? "Secure Origin Required" 
            : (isSelection ? "Configure Workspace Folder" : "Permission Required");
            
        var desc = document.createElement("p");
        desc.style.color = "#a2a6b0";
        desc.style.fontSize = "14px";
        desc.style.lineHeight = "1.6";
        desc.style.marginBottom = "30px";
        
        if (originError) {
            desc.innerHTML = "Browser File System APIs are restricted to secure contexts.<br><br>Please reload this page using <b>http://localhost:8000/</b> instead of your local IP address.";
        } else {
            desc.textContent = isSelection
                ? "To read and write files directly to your local drive, please select your TibcoGI project workspace directory (e.g. C:\\projects\\TibcoGI)."
                : "The browser requires your permission to read and write files to your selected local project workspace directory.";
        }
            
        var button = document.createElement("button");
        button.style.backgroundColor = originError ? "#ff4d6d" : "#9d4edd";
        button.style.border = "none";
        button.style.color = "white";
        button.style.padding = "12px 30px";
        button.style.borderRadius = "6px";
        button.style.fontSize = "15px";
        button.style.fontWeight = "600";
        button.style.cursor = "pointer";
        button.style.transition = "all 0.2s ease";
        button.textContent = originError 
            ? "Dismiss" 
            : (isSelection ? "Select Local Directory" : "Grant Access Permission");
            
        button.onmouseover = function() { 
            button.style.backgroundColor = originError ? "#ff758f" : "#7b2cbf"; 
            button.style.transform = "scale(1.02)"; 
        };
        button.onmouseout = function() { 
            button.style.backgroundColor = originError ? "#ff4d6d" : "#9d4edd"; 
            button.style.transform = "scale(1)"; 
        };
        
        button.onclick = async function() {
            if (originError) {
                overlay.remove();
                return;
            }
            try {
                if (isSelection) {
                    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
                    await storeHandle(handle);
                    overlay.remove();
                    await initializeVFS(handle);
                } else {
                    const handle = await retrieveHandle();
                    const granted = await handle.requestPermission({ mode: 'readwrite' });
                    if (granted === 'granted') {
                        overlay.remove();
                        await initializeVFS(handle);
                    } else {
                        alert("Permission denied. Unable to initialize local workspace.");
                    }
                }
            } catch (err) {
                console.error("Local disk folder picker failed:", err);
                alert("Folder picker failed: " + err.message);
            }
        };
        
        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(button);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
    }

    async function bootDriver() {
        var activeFsId = localStorage.getItem("__ACTIVE_FILESYSTEM_ID__") || "opfs";
        if (activeFsId !== "local") {
            if (typeof resolveReady === "function") resolveReady();
            return;
        }

        if (!window.showDirectoryPicker) {
            if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
                showPermissionOverlay(false, true);
            } else {
                console.error("File System Access API is not supported in this browser context.");
                if (typeof resolveReady === "function") resolveReady();
            }
            return;
        }

        try {
            const handle = await retrieveHandle();
            if (!handle) {
                showPermissionOverlay(true);
            } else {
                const status = await handle.queryPermission({ mode: 'readwrite' });
                if (status === 'granted') {
                    await initializeVFS(handle);
                } else {
                    showPermissionOverlay(false);
                }
            }
        } catch (err) {
            console.error("Local disk boot error:", err);
            showPermissionOverlay(true);
        }
    }

    // Initialize VFS Cache from localStorage synchronously at startup
    loadFS();

    // Start background boot
    if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", bootDriver);
    } else {
        bootDriver();
    }

    // Define classes and hooks
    function defineLocalClasses() {
        if (!window.jsx3 || !jsx3.Class || !jsx3.net || !jsx3.net.Request) return;
        
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
                        var W = jsx3.io.PLUGIN.getFileForURI(this._url);
                        if (W && W.isFile()) {
                            this._response = W.read();
                            this._status = 200;
                        } else {
                            this._status = jsx3.net.Request.STATUS_ERROR;
                        }
                        if (this._async) {
                            var me = this;
                            setTimeout(function() {
                                me.publish({subject: jsx3.net.Request.EVENT_ON_RESPONSE});
                            }, 0);
                        }
                        return this;
                    };
                    
                    q.getURL = function() { return this._url && this._url.toString(); };
                    q.getStatus = function() { return this._status || 200; };
                    q.getResponseText = function() { return this._response; };
                    q.getResponseXML = function() { return (new jsx3.xml.Document()).loadXML(this.getResponseText()); };
                });
            }

            // 2. Define LocalFileSystem Class
            if (!jsx3.Class.forName("jsx3.io.LocalFileSystem")) {
                jsx3.Class.defineClass("jsx3.io.LocalFileSystem", jsx3.io.FileSystem, null, function(i, b) {
                    b.getId = function() { return "local"; };
                    b.getFile = function(d) {
                        if (typeof d == "string" && d.match(/^[a-zA-Z]:\\/)) {
                            d = "file:///" + d.replace(/\\/g, "/");
                        }
                        var uri = jsx3.net.URI.valueOf(d);
                        if (!uri.getScheme()) {
                            uri = new jsx3.net.URI("file://" + (uri.getPath().indexOf("/") != 0 ? "/" : "") + uri.getPath());
                        }
                        return new jsx3.io.LocalFile(this, uri);
                    };

                    b.getUserDocuments = function() {
                        return this.getFile("C:\\projects");
                    };

                    b.getRoots = function() {
                        return [this.getFile("C:\\")];
                    };

                    b.createTempFile = function(prefix) {
                        var name = "temp_" + Math.random().toString(36).substring(2, 10) + ".txt";
                        var file = this.getFile("C:\\projects\\TibcoGI\\" + name);
                        file.write("");
                        return file;
                    };
                });
            }

            // Define LocalFile Class
            if (!jsx3.Class.forName("jsx3.io.LocalFile")) {
                jsx3.Class.defineClass("jsx3.io.LocalFile", jsx3.io.File, null, function(e, s) {
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
                        writeLocalFile(path, content);
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
                        makeLocalDir(path);
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
                        deleteLocalFile(path);
                    };

                    s.renameTo = function(destFile) {
                        var src = this.getPath();
                        var dest = destFile.getPath();
                        
                        if (src in files) {
                            var content = files[src];
                            files[dest] = content;
                            delete files[src];
                            writeLocalFile(dest, content);
                            deleteLocalFile(src);
                        } else if (directories.has(src)) {
                            directories.delete(src);
                            directories.add(dest);
                            makeLocalDir(dest);
                            
                            for (var f in files) {
                                if (f.indexOf(src + "\\") === 0) {
                                    var newKey = dest + f.substring(src.length);
                                    var cnt = files[f];
                                    files[newKey] = cnt;
                                    delete files[f];
                                    writeLocalFile(newKey, cnt);
                                    deleteLocalFile(f);
                                }
                            }
                            directories.forEach(function(d) {
                                if (d.indexOf(src + "\\") === 0) {
                                    var newKey = dest + d.substring(src.length);
                                    directories.add(newKey);
                                    directories.delete(d);
                                    makeLocalDir(newKey);
                                    deleteLocalFile(d);
                                }
                            });
                            deleteLocalFile(src);
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
                                children.push(new jsx3.io.LocalFile(me.getFileSystem(), pathToURI(f, false)));
                            }
                        }

                        directories.forEach(function(d) {
                            var parent = getParentOf(d);
                            if (parent && parent.toLowerCase() === pathLower && d.toLowerCase() !== pathLower && !seen[d.toLowerCase()]) {
                                seen[d.toLowerCase()] = true;
                                children.push(new jsx3.io.LocalFile(me.getFileSystem(), pathToURI(d, true)));
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
                    _inst: new jsx3.io.LocalFileSystem(),
                    getId: function() { return "local"; },
                    getSchemes: function() { return ["file"]; },
                    hasWrite: function() { return true; },
                    getInstance: function() { return this._inst; }
                };
                fsDesc._inst._desc = fsDesc;
                jsx3.io.PLUGIN._fss.push(fsDesc);
            }

            var isRunner = window.location.pathname.indexOf("shell.html") >= 0;

            // Register FileRequest scheme handler for file:/// requests (Builder only)
            if (!isRunner && jsx3.net.Request && jsx3.io.FileRequest) {
                jsx3.net.Request.addSchemeHandler("file", jsx3.io.FileRequest.jsxclass);
            }

            // Override ClassLoader's asynchronous script loader loadJSFile
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
        } catch (e) {
            console.error("[LOCAL-VFS] Error defining classes: ", e);
        }
    }

    // Synchronously define classes if already available
    if (window.jsx3 && jsx3.Class && jsx3.net && jsx3.net.Request) {
        defineLocalClasses();
    } else {
        var pollInterval = setInterval(function() {
            if (window.jsx3 && jsx3.Class && jsx3.net && jsx3.net.Request) {
                clearInterval(pollInterval);
                defineLocalClasses();
            }
        }, 50);
    }
})();
