sudo apt install python3-websockets

<pre><font color="#26A269"><b>rlyman@8470p</b></font>:<font color="#12488B"><b>~/breakout</b></font>$ sudo apt install python3-websockets
[sudo] password for rlyman: 
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
The following NEW packages will be installed:
  python3-websockets
0 upgraded, 1 newly installed, 0 to remove and 0 not upgraded.
Need to get 64.0 kB of archives.
After this operation, 379 kB of additional disk space will be used.
Get:1 http://us.archive.ubuntu.com/ubuntu noble/universe amd64 python3-websockets all 10.4-1 [64.0 kB]
Fetched 64.0 kB in 3s (24.5 kB/s)<font color="#A2734C">             </font>
Selecting previously unselected package python3-websockets.
(Reading database ... 325389 files and directories currently installed.)
Preparing to unpack .../python3-websockets_10.4-1_all.deb ...
Unpacking python3-websockets (10.4-1) ...
Setting up python3-websockets (10.4-1) ...
<font color="#26A269"><b>rlyman@8470p</b></font>:<font color="#12488B"><b>~/breakout</b></font>$ 
</pre>

clone directory

<pre><font color="#26A269"><b>rlyman@8470p</b></font>:<font color="#12488B"><b>~</b></font>$ cd breakout_2/
<font color="#26A269"><b>rlyman@8470p</b></font>:<font color="#12488B"><b>~/breakout_2</b></font>$ python3 breakout.py
pygame 2.5.2 (SDL 2.30.0, Python 3.12.3)
Hello from the pygame community. https://www.pygame.org/contribute.html
<font color="#26A269"><b>rlyman@8470p</b></font>:<font color="#12488B"><b>~/breakout_2</b></font>$ 
</pre>


<pre><font color="#26A269"><b>rlyman@8470p</b></font>:<font color="#12488B"><b>~/breakout_2</b></font>$ python3 -m websockets --version
websockets 10.4
<font color="#26A269"><b>rlyman@8470p</b></font>:<font color="#12488B"><b>~/breakout_2</b></font>$ 
</pre>

<pre><font color="#26A269"><b>rlyman@8470p</b></font>:<font color="#12488B"><b>~/breakout_2</b></font>$ pip install --upgrade websockets
<font color="#C01C28"><b>error</b></font>: <b>externally-managed-environment</b>

<font color="#C01C28">×</font> This environment is externally managed
<font color="#C01C28">╰─&gt;</font> To install Python packages system-wide, try apt install
<font color="#C01C28">   </font> python3-xyz, where xyz is the package you are trying to
<font color="#C01C28">   </font> install.
<font color="#C01C28">   </font> 
<font color="#C01C28">   </font> If you wish to install a non-Debian-packaged Python package,
<font color="#C01C28">   </font> create a virtual environment using python3 -m venv path/to/venv.
<font color="#C01C28">   </font> Then use path/to/venv/bin/python and path/to/venv/bin/pip. Make
<font color="#C01C28">   </font> sure you have python3-full installed.
<font color="#C01C28">   </font> 
<font color="#C01C28">   </font> If you wish to install a non-Debian packaged Python application,
<font color="#C01C28">   </font> it may be easiest to use pipx install xyz, which will manage a
<font color="#C01C28">   </font> virtual environment for you. Make sure you have pipx installed.
<font color="#C01C28">   </font> 
<font color="#C01C28">   </font> See /usr/share/doc/python3.12/README.venv for more information.

<font color="#A347BA"><b>note</b></font>: If you believe this is a mistake, please contact your Python installation or OS distribution provider. You can override this, at the risk of breaking your Python installation or OS, by passing --break-system-packages.
<font color="#2AA1B3"><b>hint</b></font>: See PEP 668 for the detailed specification.
<font color="#26A269"><b>rlyman@8470p</b></font>:<font color="#12488B"><b>~/breakout_2</b></font>$ sudo apt-get update
sudo apt-get install --only-upgrade python3-websockets
[sudo] password for rlyman: 
Hit:1 http://security.ubuntu.com/ubuntu noble-security InRelease
Hit:2 https://dl.google.com/linux/chrome/deb stable InRelease                                                                  
Hit:3 https://dl.google.com/linux/chrome-stable/deb stable InRelease                                                           
Hit:4 http://us.archive.ubuntu.com/ubuntu noble InRelease                                                                      
Hit:5 http://us.archive.ubuntu.com/ubuntu noble-updates InRelease                                                              
Hit:6 https://us-central1-apt.pkg.dev/projects/antigravity-auto-updater-dev antigravity-debian InRelease
Hit:7 http://us.archive.ubuntu.com/ubuntu noble-backports InRelease
Hit:8 https://ppa.launchpadcontent.net/ubuntuhandbook1/audacity/ubuntu noble InRelease
Reading package lists... Done
N: Skipping acquire of configured file &apos;main/binary-i386/Packages&apos; as repository &apos;https://us-central1-apt.pkg.dev/projects/antigravity-auto-updater-dev antigravity-debian InRelease&apos; doesn&apos;t support architecture &apos;i386&apos;
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
python3-websockets is already the newest version (10.4-1).
0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
<font color="#26A269"><b>rlyman@8470p</b></font>:<font color="#12488B"><b>~/breakout_2</b></font>$ 

</pre>