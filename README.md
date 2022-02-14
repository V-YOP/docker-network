# docker-network
allow docker for windows and Mac OS X to access containers via IP, inspired by [mesosphere/docker-mac-network](https://github.com/mesosphere/docker-mac-network) and [wojas/docker-mac-network](https://github.com/wojas/docker-mac-network) 

# usage

To use this solution, you should——

0. install Nodejs v14.16.0 or later
  This program is written in javascript and need nodejs runtime environment.
1. Install [Tunnelblick](https://tunnelblick.net/downloads.html) for Mac OS X or [OpenVPN GUI](https://openvpn.net/community-downloads/) for Windows
2. create a network (optional)
  A network is needed for you to access container within it, but you can use the default bridge network, you can use `docker network create` command to create it, e.g. `docker network create --subnet 172.19.0.0/16 my_network`.
3. edit `docker-network.js` and change the configuration as your need.
4. run `node ./docker-network.js create` (if Permission denied, run `chmod +x ./docker-network.js`)
5. when finished, import it to your GUI client
6. try it!

# Limitation

- It only works for containers in a given network
