<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
    <xsl:template match="/">
        <html>
        <head>
            <title>Article Display</title>
        </head>
        <body>
            <h1><xsl:value-of select="article/title"/></h1>
            <h2>Authors:</h2>
            <ul>
                <xsl:for-each select="article/authors/author">
                    <li><xsl:value-of select="."/></li>
                </xsl:for-each>
            </ul>
            <p><xsl:value-of select="article/body"/></p>
        </body>
        </html>
    </xsl:template>
</xsl:stylesheet>
