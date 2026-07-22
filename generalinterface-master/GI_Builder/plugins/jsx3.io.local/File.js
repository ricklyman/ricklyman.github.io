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

    window.__VFS_FILES__ = window.__VFS_FILES__ || {};
    window.__VFS_FILES__["local"] = window.__VFS_FILES__["local"] || {};
    var files = window.__VFS_FILES__["local"];
    var directories = new Set();
    var rootHandle = null;

    function getWorkspacePath() {
        var wsPath = "C:\\projects\\TibcoGI";
        try {
            if (window.jsx3 && jsx3.ide && typeof jsx3.ide.getCurrentUserHome === "function") {
                var home = jsx3.ide.getCurrentUserHome();
                if (home) {
                    wsPath = home.getPath();
                }
            }
        } catch (e) {}
        return wsPath;
    }

    function getVirtualBase() {
        var loc = window.location;
        var dir = loc.pathname.substring(0, loc.pathname.lastIndexOf("/") + 1);
        return loc.origin + dir + "virtual";
    }

    function trackPromise(p) {
        if (p && typeof p.then === "function") {
            window.__VFS_PENDING_WRITES__ = window.__VFS_PENDING_WRITES__ || [];
            window.__VFS_PENDING_WRITES__.push(p);
            var cleanUp = function() {
                var idx = window.__VFS_PENDING_WRITES__.indexOf(p);
                if (idx >= 0) window.__VFS_PENDING_WRITES__.splice(idx, 1);
            };
            p.then(cleanUp).catch(cleanUp);
        }
    }

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
    
    function isRootPath(path) {
        if (!path) return true;
        var pLower = path.toLowerCase().replace(/\\/g, "/");
        if (pLower.endsWith("/") && pLower.length > 1) pLower = pLower.substring(0, pLower.length - 1);
        return pLower === "" || pLower === "root" || pLower === "c:" || pLower === "c:\\" || pLower === "\\" || pLower === "/";
    }

    function hasDirectory(path) {
        if (isRootPath(path)) return true;
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
        if (isRootPath(path) || path.match(/^[a-zA-Z]:\\$/)) return null;
        var p = path.replace(/\//g, "\\");
        var idx = p.lastIndexOf("\\");
        if (idx <= 0) return "root";
        var parent = p.substring(0, idx);
        return normalizePath(parent);
    }

    function pathToURI(path, isDir) {
        var p = path.replace(/\\/g, "/");
        var actualIsDir = isDir || (directories && directories.has(path)) || !path.substring(path.lastIndexOf("\\") + 1).includes(".");
        if (actualIsDir && !p.endsWith("/")) {
            p += "/";
        }
        if (!p.startsWith("/")) p = "/" + p;
        return jsx3.net.URI.valueOf(getVirtualBase() + p);
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
                    var ws = getWorkspacePath();
                    directories.add("C:\\");
                    var parent = getParentOf(ws);
                    if (parent) directories.add(parent);
                    directories.add(ws);
                }
                return;
            }
        } catch (e) {
            console.error("Failed to load local VFS cache from localStorage:", e);
        }
        files = {};
        var ws = getWorkspacePath();
        var parent = getParentOf(ws);
        directories = new Set(["C:\\"]);
        if (parent) directories.add(parent);
        directories.add(ws);
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
        try {
            localStorage.setItem("__RUNNER_VFS_CACHE__", JSON.stringify(files));
        } catch (e) {}
    }

    // IndexedDB helpers to persist DirectoryHandle
    function openDB() {
        return new Promise(function(resolve, reject) {
            var request = indexedDB.open("LocalDiskVFS_DB", 2);
            request.onupgradeneeded = function(e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains("handles")) {
                    db.createObjectStore("handles");
                }
            };
            request.onsuccess = function(e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains("handles")) {
                    db.close();
                    var delReq = indexedDB.deleteDatabase("LocalDiskVFS_DB");
                    delReq.onsuccess = function() {
                        var req2 = indexedDB.open("LocalDiskVFS_DB", 3);
                        req2.onupgradeneeded = function(ev) {
                            ev.target.result.createObjectStore("handles");
                        };
                        req2.onsuccess = function(ev) {
                            resolve(ev.target.result);
                        };
                        req2.onerror = function(ev) {
                            reject(ev.target.error);
                        };
                    };
                    delReq.onerror = function() {
                        reject(new Error("Failed to recreate VFS database"));
                    };
                } else {
                    resolve(db);
                }
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
            var ws = getWorkspacePath();
            if (path.toLowerCase().indexOf(ws.toLowerCase()) === 0) {
                relativePath = path.substring(ws.length);
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
            var ws = getWorkspacePath();
            if (path.toLowerCase().indexOf(ws.toLowerCase()) === 0) {
                relativePath = path.substring(ws.length);
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
            var ws = getWorkspacePath();
            if (path.toLowerCase().indexOf(ws.toLowerCase()) === 0) {
                relativePath = path.substring(ws.length);
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
        var ws = getWorkspacePath();
        directories = new Set(["C:\\"]);
        var parent = ws;
        while (parent) {
            directories.add(parent);
            parent = getParentOf(parent);
        }
        
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
            await scan(handle, ws);
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
            var ws = getWorkspacePath();
            if (virtualPath.toLowerCase().indexOf(ws.toLowerCase()) === 0) {
                relativePath = virtualPath.substring(ws.length);
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
                             d = getVirtualBase() + "/" + d.replace(/\\/g, "/");
                         }
                         var uri = jsx3.net.URI.valueOf(d);
                         if (!uri.getScheme()) {
                             uri = new jsx3.net.URI(getVirtualBase() + (uri.getPath().indexOf("/") != 0 ? "/" : "") + uri.getPath());
                         }
                         return new jsx3.io.LocalFile(this, uri);
                     };

                    b.getUserDocuments = function() {
                        return this.getFile(getWorkspacePath());
                    };

                    b.getRoots = function() {
                        return [this.getFile("C:\\")];
                    };

                    b.createTempFile = function(prefix) {
                        var name = "temp_" + Math.random().toString(36).substring(2, 10) + ".txt";
                        var file = this.getFile(getWorkspacePath() + "\\" + name);
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
                            var vIdx = path.toLowerCase().indexOf("/virtual/");
                            if (vIdx >= 0) {
                                path = path.substring(vIdx + 9);
                            }
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

    function isSystemPath(path) {
        if (!path) return false;
        var p = path.toLowerCase().replace(/\\/g, "/");
        return p.indexOf("gi_builder") >= 0 || p.indexOf("jsx/") >= 0 || p.indexOf("prototypes") >= 0;
    }

    function resolveRelative(relPath) {
        if (relPath.startsWith("/")) relPath = relPath.substring(1);
        try {
            if (window.jsx3 && jsx3.net && jsx3.net.URIResolver && jsx3.net.URIResolver.DEFAULT) {
                return jsx3.net.URIResolver.DEFAULT.resolveURI(relPath).toString();
            }
        } catch (e) {}
        return relPath;
    }

    function resolveSystemHttpUrl(pathStr) {
        if (!pathStr) return "";
        var p = pathStr.replace(/\\/g, "/");
        var pLower = p.toLowerCase();
        
        var protoIdx = pLower.indexOf("prototypes/");
        if (protoIdx >= 0) return p.substring(protoIdx);
        
        var giIdx = pLower.indexOf("gi_builder/");
        if (giIdx >= 0) return p.substring(giIdx);
        
        var jsxIdx = pLower.indexOf("jsx/");
        if (jsxIdx >= 0) return p.substring(jsxIdx);
        
        return p;
    }

    var SYSTEM_MANIFEST_FALLBACKS = {
        "prototypes": ["Block", "Containers", "Form_Elements", "Labels", "Matrix", "Menus_and_Toolbars", "Miscellaneous", "~Deprecated"],
        "prototypes/block": ["Block.xml"],
        "prototypes/containers": ["Dialog.xml", "LayoutGrid.xml", "Splitter.xml", "TabbedPane.xml", "WindowBar.xml"],
        "prototypes/form_elements": ["Button.xml", "CheckBox.xml", "DatePicker.xml", "ImageButton.xml", "RadioButton.xml", "Select.xml", "Slider.xml", "TextBox.xml", "TimePicker.xml"],
        "prototypes/labels": ["Label.xml"],
        "prototypes/matrix": ["Columns", "Matrix.xml", "Tree.xml"],
        "prototypes/matrix/columns": ["Checkbox.xml", "Combo.xml", "Date.xml", "DatePicker.xml", "Delete.xml", "DialogMask.xml", "Image.xml", "ImageButton.xml", "Menu.xml", "NativeButton.xml", "NativeSelect.xml", "NumberCheck.xml", "NumberInput.xml", "RadioButton.xml", "Select.xml", "Text.xml", "TextArea.xml", "TextBox.xml", "TextHTML.xml", "TextNumber.xml", "Time.xml", "TimePicker.xml", "ToolbarButton.xml"],
        "prototypes/menus_and_toolbars": ["Menu.xml", "MenuItem.xml", "TaskBar.xml", "Toolbar.xml", "ToolbarButton.xml"],
        "prototypes/miscellaneous": ["CDF.xml", "CDFMasterDetail.xml", "CDFSchema.xml", "Sound.xml", "SoundButton.xml", "Table.xml", "Tree.xml"],
        "prototypes/~deprecated": ["Grids", "Lists", "MultiSelect.xml"],
        "prototypes/~deprecated/grids": ["Columns", "Grid.xml"],
        "prototypes/~deprecated/lists": ["Columns", "List.xml"]
    };

    function fetchManifestChildrenLocal(fileObj) {
        var children = [];
        try {
            var path = fileObj.getPath();
            var manifestRelPath = path + (path.endsWith("\\") || path.endsWith("/") ? "" : "/") + ".manifest";
            var httpUrl = resolveSystemHttpUrl(manifestRelPath);

            var text = null;
            try {
                var req = jsx3.net.Request.open("GET", httpUrl, false);
                req.send();
                if (req.getStatus() === 200 && req.getResponseText()) {
                    text = req.getResponseText();
                }
            } catch (e) {}

            if (!text) {
                var p = path.toLowerCase().replace(/\\/g, "/");
                var idx = p.indexOf("prototypes");
                var key = idx >= 0 ? p.substring(idx) : p;
                if (key.endsWith("/")) key = key.substring(0, key.length - 1);
                var fallbackList = SYSTEM_MANIFEST_FALLBACKS[key];
                if (fallbackList) {
                    text = fallbackList.join("\n");
                }
            }

            if (text) {
                var lines = text.split(/\r?\n/);
                var fs = fileObj.getFileSystem();
                var basePath = path + (path.endsWith("\\") || path.endsWith("/") ? "" : "/");
                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (!line) continue;
                    var childPath = basePath + line;
                    children.push(new jsx3.io.LocalFile(fs, pathToURI(childPath, !line.endsWith(".xml"))));
                }
            }
        } catch (e) {
            console.warn("[LocalFile] Manifest fetch error for system path:", fileObj.getPath(), e);
        }
        return children;
    }

                    s.exists = function() {
                        if (this.isRoot()) return true;
                        var path = this.getPath();
                        if (hasFile(path) || hasDirectory(path)) return true;
                        if (isSystemPath(path)) return true;
                        return false;
                    };

                    s.isFile = function() {
                        if (this.isRoot()) return false;
                        var path = this.getPath();
                        if (hasFile(path)) return true;
                        if (hasDirectory(path)) return false;
                        if (isSystemPath(path)) {
                            var p = path.replace(/\\/g, "/");
                            var lastSegment = p.substring(p.lastIndexOf("/") + 1);
                            if (lastSegment.includes(".")) return true;
                        }
                        return false;
                    };

                    s.isDirectory = function() {
                        if (this.isRoot()) return true;
                        var path = this.getPath();
                        if (hasDirectory(path)) return true;
                        if (hasFile(path)) return false;
                        if (isSystemPath(path)) {
                            var p = path.replace(/\\/g, "/");
                            var lastSegment = p.substring(p.lastIndexOf("/") + 1);
                            if (!lastSegment.includes(".")) return true;
                        }
                        return false;
                    };

                    var DEFAULT_CONFIG_XML = '<data>\n  <record jsxid="version" type="string">1.0</record>\n  <record jsxid="jsxversion" type="string">3.2</record>\n  <record jsxid="caption" type="string">Application</record>\n  <record jsxid="mode" type="boolean">true</record>\n  <record jsxid="namespace" type="string">eg</record>\n  <record jsxid="cancelerror" type="boolean">true</record>\n  <record jsxid="cancelrightclick" type="boolean">true</record>\n  <record jsxid="left" type="number">0</record>\n  <record jsxid="top" type="number">0</record>\n  <record jsxid="width" type="string">100%</record>\n  <record jsxid="height" type="string">100%</record>\n  <record jsxid="position" type="number">0</record>\n  <record jsxid="overflow" type="number">3</record>\n  <record jsxid="eventsvers" type="number">3.1</record>\n  <record jsxid="default_locale" type="string">en_US</record>\n  <record jsxid="onload" type="string"><![CDATA[]]></record>\n  <record jsxid="objectseturl" type="string"><![CDATA[components/appCanvas.xml]]></record>\n  <record jsxid="includes" type="array">\n    <record jsxid="0" type="map">\n      <record jsxid="id" type="string">appCanvas_component</record>\n      <record jsxid="type" type="string">component</record>\n      <record jsxid="src" type="string">components/appCanvas.xml</record>\n    </record>\n    <record jsxid="0" type="map">\n      <record jsxid="id" type="string">logic_js</record>\n      <record jsxid="type" type="string">script</record>\n      <record jsxid="load" type="number">1</record>\n      <record jsxid="src" type="string">js/logic.js</record>\n    </record>\n  </record>\n</data>';

                    s.read = function() {
                        var path = this.getPath();
                        var content = getFileContent(path);
                        if (content !== undefined && content && content.trim().length > 10) return content;
                        if (isSystemPath(path)) {
                            try {
                                var httpUrl = resolveSystemHttpUrl(path);
                                var req = jsx3.net.Request.open("GET", httpUrl, false);
                                req.send();
                                if (req.getStatus() === 200 && req.getResponseText()) {
                                    var resp = req.getResponseText();
                                    setFileContent(path, resp);
                                    return resp;
                                }
                            } catch (e) {}
                        }
                        if (path.toLowerCase().endsWith("config.xml")) {
                            setFileContent(path, DEFAULT_CONFIG_XML);
                            persistFS();
                            return DEFAULT_CONFIG_XML;
                        }
                        if (path.toLowerCase().endsWith("logic.js")) {
                            var dJs = '// Project logic script\njsx3.lang.Package.definePackage("eg", function(eg) {});\n';
                            setFileContent(path, dJs);
                            persistFS();
                            return dJs;
                        }
                        if (path.toLowerCase().endsWith("appcanvas.xml")) {
                            var dCanvas = '<serialization xmlns="urn:tibco.com/v3.0" jsxversion="3.9">\n  <onAfterDeserialize></onAfterDeserialize>\n  <object type="jsx3.gui.LayoutGrid">\n    <variants jsxrelativeposition="0" left="0" top="0"/>\n    <strings name="appCanvas" width="100%" height="100%"/>\n  </object>\n</serialization>';
                            setFileContent(path, dCanvas);
                            persistFS();
                            return dCanvas;
                        }
                        return content || "";
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
                        trackPromise(writeLocalFile(path, content));
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
                        trackPromise(makeLocalDir(path));
                    };

                    s.deleteFile = function() {
                        var path = this.getPath();
                        if (!path) return false;
                        var pathLower = path.toLowerCase();
                        var matched = Object.keys(files).find(function(k) { return k.toLowerCase() === pathLower; });
                        if (matched) {
                            delete files[matched];
                            persistFS();
                            trackPromise(deleteLocalFile(path));
                            return true;
                        } else if (hasDirectory(path)) {
                            var dirs = Array.from(directories);
                            var matchedDir = dirs.find(function(d) { return d.toLowerCase() === pathLower; });
                            if (matchedDir) directories.delete(matchedDir);
                            for (var f in files) {
                                if (f.toLowerCase().startsWith(pathLower + "\\") || f.toLowerCase().startsWith(pathLower + "/")) {
                                    delete files[f];
                                }
                            }
                            persistFS();
                            trackPromise(deleteLocalFile(path));
                            return true;
                        }
                        return false;
                    };

                    s.renameTo = function(destFile) {
                        var src = this.getPath();
                        var dest = typeof destFile === "string" ? destFile : (destFile && destFile.getPath ? destFile.getPath() : String(destFile));
                        if (!src || !dest) return false;

                        var content = getFileContent(src);
                        if (content !== undefined) {
                            setFileContent(dest, content);
                            var srcLower = src.toLowerCase();
                            var matched = Object.keys(files).find(function(k) { return k.toLowerCase() === srcLower; });
                            if (matched) delete files[matched];

                            var parent = typeof destFile === "object" && destFile.getParentPath ? destFile.getParentPath() : getParentOf(dest);
                            while (parent) {
                                directories.add(parent);
                                parent = getParentOf(parent);
                            }
                            persistFS();
                            trackPromise(writeLocalFile(dest, content));
                            trackPromise(deleteLocalFile(src));
                            return true;
                        } else if (hasDirectory(src)) {
                            var srcLower = src.toLowerCase();
                            var dirs = Array.from(directories);
                            var matchedDir = dirs.find(function(d) { return d.toLowerCase() === srcLower; });
                            if (matchedDir) directories.delete(matchedDir);
                            directories.add(dest);
                            trackPromise(makeLocalDir(dest));

                            for (var f in files) {
                                if (f.toLowerCase().startsWith(srcLower + "\\") || f.toLowerCase().startsWith(srcLower + "/")) {
                                    var newKey = dest + f.substring(src.length);
                                    var cnt = files[f];
                                    setFileContent(newKey, cnt);
                                    delete files[f];
                                    trackPromise(writeLocalFile(newKey, cnt));
                                    trackPromise(deleteLocalFile(f));
                                }
                            }
                            persistFS();
                            trackPromise(deleteLocalFile(src));
                            return true;
                        }
                        return false;
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

                        if (children.length === 0 && isSystemPath(path)) {
                            children = fetchManifestChildrenLocal(me);
                        }

                        return children;
                    };

                    s.isHidden = function() { return false; };
                    s.isReadOnly = function() { return false; };
                    s.setReadOnly = function(d) {};
                    s.isRoot = function() {
                        return isRootPath(this.getPath());
                    };
                    s.getParentFile = function() {
                        if (this.isRoot()) return null;
                        var path = this.getPath();
                        var parentPath = getParentOf(path);
                        if (parentPath == null || parentPath === path) return null;
                        return this._fs.getFile(pathToURI(parentPath, true));
                    };
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
                    var lowerUrl = urlStr.toLowerCase();
                    var virtualBase = getVirtualBase().toLowerCase();
                    if (urlStr && (lowerUrl.indexOf("file:") >= 0 || lowerUrl.indexOf("virtual/") >= 0 || lowerUrl.indexOf(virtualBase) >= 0)) {
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

            function overrideGetFileForURI(plugin) {
                if (plugin && !plugin._vfs_overridden) {
                    plugin._vfs_overridden = true;
                    var originalGetFileForURI = plugin.getFileForURI;
                    var inGetSystemDir = false;
                    plugin.getFileForURI = function(objURI) {
                        var uri = jsx3.net.URI.valueOf(objURI);
                        var scheme = uri ? uri.getScheme() : "";
                        var uriStr = uri ? uri.toString().toLowerCase() : "";
                        var isProjectFile = (uriStr.indexOf("jsxapps/") >= 0 || uriStr.indexOf("virtual/") >= 0);
                        var isVirtual = (scheme === "file" || scheme === "" || isProjectFile);

                        if (uri && isVirtual) {
                            var isBuilderSystemFile = false;

                            if (uriStr.indexOf("virtual/") < 0 && uriStr.indexOf("jsxapps/") < 0) {
                                if (uriStr.indexOf("/gi_builder/") >= 0 || uriStr.indexOf("/jsx/") >= 0) {
                                    isBuilderSystemFile = true;
                                } else if (!inGetSystemDir && window.jsx3 && jsx3.ide && typeof jsx3.ide.getSystemDirFile === "function") {
                                    try {
                                        inGetSystemDir = true;
                                        var sysDirFile = jsx3.ide.getSystemDirFile();
                                        var systemDir = sysDirFile ? sysDirFile.toURI().toString().toLowerCase() : "";
                                        inGetSystemDir = false;
                                        if (systemDir && uriStr.indexOf(systemDir) === 0) {
                                            isBuilderSystemFile = true;
                                        }
                                    } catch (e) {
                                        inGetSystemDir = false;
                                    }
                                }
                            }

                            if (!isBuilderSystemFile) {
                                var activeFsId = localStorage.getItem("__ACTIVE_FILESYSTEM_ID__") || "local";
                                var availFs = this.getAvailableFileSystems();
                                var fs = availFs.find(function(e) { return e.getId() === activeFsId; }) || availFs[0];
                                if (fs) {
                                    return fs.getInstance().getFile(uri);
                                }
                            }
                        }
                        return originalGetFileForURI.call(this, objURI);
                    };
                }
            }

            // Patch XmlReqFile and XmlReqFileSystem if they exist to redirect VFS project operations
            if (jsx3.io.XmlReqFile) {
                jsx3.io.XmlReqFile.prototype.write = function(content, options) {
                    var uri = this.toURI();
                    var activeFsId = localStorage.getItem("__ACTIVE_FILESYSTEM_ID__") || "local";
                    var realPlugin = jsx3.io.PLUGIN;
                    if (realPlugin) {
                        var availFs = realPlugin.getAvailableFileSystems();
                        var fs = availFs.find(function(e) { return e.getId() === activeFsId; }) || availFs[0];
                        if (fs) {
                            var realFile = fs.getInstance().getFile(uri);
                            if (realFile && realFile !== this) {
                                return realFile.write(content, options);
                            }
                        }
                    }
                    return false;
                };

                jsx3.io.XmlReqFile.prototype.isReadOnly = function() {
                    var uri = this.toURI();
                    var uriStr = uri ? uri.toString().toLowerCase() : "";
                    if (uriStr.indexOf("jsxapps/") >= 0 || uriStr.indexOf("virtual/") >= 0) {
                        return false;
                    }
                    return true;
                };
            }

            if (jsx3.io.XmlReqFileSystem) {
                jsx3.io.XmlReqFileSystem.prototype.createTempFile = function(prefix) {
                    var activeFsId = localStorage.getItem("__ACTIVE_FILESYSTEM_ID__") || "local";
                    var realPlugin = jsx3.io.PLUGIN;
                    if (realPlugin) {
                        var availFs = realPlugin.getAvailableFileSystems();
                        var fs = availFs.find(function(e) { return e.getId() === activeFsId; }) || availFs[0];
                        if (fs) {
                            return fs.getInstance().createTempFile(prefix);
                        }
                    }
                    var name = "temp_" + Math.random().toString(36).substring(2, 10) + ".txt";
                    return this.getFile("/tmp/" + prefix + name);
                };
            }

            if (window.jsx3 && jsx3.io) {
                var realPlugin = jsx3.io.PLUGIN || null;
                if (realPlugin) {
                    overrideGetFileForURI(realPlugin);
                }
                Object.defineProperty(jsx3.io, "PLUGIN", {
                    get: function() { return realPlugin; },
                    set: function(val) {
                        realPlugin = val;
                        if (val) {
                            overrideGetFileForURI(val);
                        }
                    },
                    configurable: true
                });
            }
            if (window.jsx3 && jsx3.ide) {
                jsx3.ide._CURRENT_USER_HOME = null;
                patchWriteUserXmlFile();
            }
        } catch (e) {
            console.error("[LOCAL-VFS] Error defining classes: ", e);
        }
    }

    function patchWriteUserXmlFile() {
        if (window.jsx3 && jsx3.ide && typeof jsx3.ide.writeUserXmlFile === "function") {
            if (!jsx3.ide._vfs_writeUserXmlFile_patched) {
                jsx3.ide._vfs_writeUserXmlFile_patched = true;
                var origWriteUserXml = jsx3.ide.writeUserXmlFile;
                jsx3.ide.writeUserXmlFile = function(m, h) {
                    try {
                        var qa = jsx3.ide.getIDESettings ? jsx3.ide.getIDESettings() : null;
                        var Va = qa ? (qa.get("prefs", "builder") || {}) : {};
                        var Qa = Va.xmlencodeas ? Va.xmloutputcharset : Va.outputcharset;
                        var rawStr = h ? (typeof h.serialize === "function" ? h.serialize(Va.addcharset && Qa ? true : false, Qa) : String(h)) : "";
                        var xmlStr = (typeof jsx3.ide.dL === "function") ? jsx3.ide.dL(rawStr) : rawStr;
                        var res = m.write(xmlStr, { charset: Qa, linebreakmode: Va.outputlinesep, charsetfailover: true });
                        if (res !== false) {
                            console.log("[VFS-IDE-SAVE] Successfully saved XML component directly:", m.toString());
                            return true;
                        }
                    } catch (e) {
                        console.warn("[VFS-IDE-SAVE] Direct writeUserXmlFile error, using original:", e);
                    }
                    return origWriteUserXml.call(this, m, h);
                };
            }
        }
    }

    // Synchronously define classes if already available
    if (window.jsx3 && jsx3.Class && jsx3.net && jsx3.net.Request) {
        defineLocalClasses();
    }
    var pollInterval = setInterval(function() {
        if (window.jsx3 && jsx3.Class && jsx3.net && jsx3.net.Request) {
            defineLocalClasses();
        }
        patchWriteUserXmlFile();
        if (window.jsx3 && jsx3.ide && jsx3.ide._vfs_writeUserXmlFile_patched) {
            clearInterval(pollInterval);
        }
    }, 100);
})();
