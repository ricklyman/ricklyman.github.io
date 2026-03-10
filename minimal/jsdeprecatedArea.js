//<![CDATA[
//--
//-- Deprecated Crypto functions and associated conversion routines.
//-- Use the jQuery.encoding functions directly instead.
//--

// Crypto 'namespace'
function Crypto() {}

// Convert a string to an array of big-endian 32-bit words
Crypto.strToBe32s = function(str)
{
    return jQuery.encoding.strToBe32s(str);
};

// Convert an array of big-endian 32-bit words to a string
Crypto.be32sToStr = function(be)
{
    return jQuery.encoding.be32sToStr(be);
};

// Convert an array of big-endian 32-bit words to a hex string
Crypto.be32sToHex = function(be)
{
    return jQuery.encoding.be32sToHex(be);
};

// Return, in hex, the SHA-1 hash of a string
Crypto.hexSha1Str = function(str)
{
    return jQuery.encoding.digests.hexSha1Str(str);
};

// Return the SHA-1 hash of a string
Crypto.sha1Str = function(str)
{
    return jQuery.encoding.digests.sha1Str(str);
};

// Calculate the SHA-1 hash of an array of blen bytes of big-endian 32-bit words
Crypto.sha1 = function(x,blen)
{
    return jQuery.encoding.digests.sha1(x,blen);
};

//--
//-- Deprecated DOM utilities
//--

// @Deprecated: Use jQuery.stylesheet instead
function setStylesheet(s,id,doc)
{
    jQuery.twStylesheet(s,{ id: id, doc: doc });
}

// @Deprecated: Use jQuery.stylesheet.remove instead
function removeStyleSheet(id)
{
    jQuery.twStylesheet.remove({ id: id });
}
//--
//-- Deprecated HTTP request code
//-- Use the jQuery ajax functions directly instead
//--

function loadRemoteFile(url,callback,params)
{
    return httpReq("GET",url,callback,params);
}

function doHttp(type,url,data,contentType,username,password,callback,params,headers,allowCache)
{
    return httpReq(type,url,callback,params,headers,data,contentType,username,password,allowCache);
}

function httpReq(type,url,callback,params,headers,data,contentType,username,password,allowCache)
{
    var options = {
        type:type,
        url:url,
        processData:false,
        data:data,
        cache:!!allowCache,
        beforeSend: function(xhr) {
            for(var i in headers)
                xhr.setRequestHeader(i,headers[i]);
            xhr.setRequestHeader("X-Requested-With", "TiddlyWiki " + formatVersion());
        }
    };

    if(callback) {
        options.complete = function(xhr,textStatus) {
            if(jQuery.httpSuccess(xhr))
                callback(true,params,xhr.responseText,url,xhr);
            else
                callback(false,params,null,url,xhr);
        };
    }
    if(contentType)
        options.contentType = contentType;
    if(username)
        options.username = username;
    if(password)
        options.password = password;
    if(window.Components && window.netscape && window.netscape.security && document.location.protocol.indexOf("http") == -1)
        window.netscape.security.PrivilegeManager.enablePrivilege("UniversalBrowserRead");
    return jQuery.ajax(options);
}

//--
//-- Deprecated String functions
//--

// @Deprecated: no direct replacement, since not used in core code
String.prototype.toJSONString = function()
{
    // Convert a string to it's JSON representation by encoding control characters, double quotes and backslash. See json.org
    var m = {
        '\b': '\\b',
        '\f': '\\f',
        '\n': '\\n',
        '\r': '\\r',
        '\t': '\\t',
        '"' : '\\"',
        '\\': '\\\\'
    };
    var replaceFn = function(a,b) {
        var c = m[b];
        if(c)
            return c;
        c = b.charCodeAt();
        return '\\u00' + Math.floor(c / 16).toString(16) + (c % 16).toString(16);
    };
    if(/["\\\x00-\x1f]/.test(this))
        return '"' + this.replace(/([\x00-\x1f\\"])/g,replaceFn) + '"';
    return '"' + this + '"';
};

//--
//-- Deprecated Tiddler code
//--

// @Deprecated: Use tiddlerToRssItem(tiddler,uri) instead
Tiddler.prototype.toRssItem = function(uri)
{
    return tiddlerToRssItem(this,uri);
};

// @Deprecated: Use "<item>\n" + tiddlerToRssItem(tiddler,uri)  + "\n</item>" instead
Tiddler.prototype.saveToRss = function(uri)
{
    return "<item>\n" + tiddlerToRssItem(this,uri) + "\n</item>";
};

// @Deprecated: Use jQuery.encoding.digests.hexSha1Str instead
Tiddler.prototype.generateFingerprint = function()
{
    return "0x" + Crypto.hexSha1Str(this.text);
};

//]]>
