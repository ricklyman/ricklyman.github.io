function giSubWrite(giApp) {
    newWindow = window.open("","","toolbar=0,location=0,status=1,menubar=0,resizable=1,height=200,width=300");
    newWindow.focus();
    var newContent = '<HTML><HEAD><TITLE>A New Doc</TITLE></HEAD>';
    newContent += '<BODY BGCOLOR="silver" style="position:absolute;width:100%;height:100%;left:0px;top:0px;padding:0px;margin:0px;border:0px;overflow:hidden;"><H1>This document is brand new.</H1>';

newContent += '	<div id="jsxmain" style="position:absolute;left:0px;top:22px;width:100%;height:100%;">';
newContent += '	<script type="text/javascript" src="gi-3.9-source/JSX/js/JSX30.js" jsxapppath="JSXAPPS/';
newContent += giApp;
newContent += '">';
newContent += '<\/script>';
newContent += '</div>';

	newContent += '</BODY></HTML>';
    newWindow.document.write(newContent);
    newWindow.document.close(); // close layout stream
}
