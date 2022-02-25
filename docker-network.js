// ----------------------------
// ---------- config ----------
// ----------------------------

const OPENVPN_IMAGE = "kylemanna/openvpn"
const CONTAINER_NAME = "haru_urara"
const VOLUME_NAME = "ovpn-data"
// host can access containers in this network via IP
// you can use the network you created or the default "bridge" network, whose subnet is "172.16.0.0/16"
const NETWORK = "yuuki.net"

// ---------------------------
// ---------- logic ----------
// ---------------------------
const { spawnSync } = require("child_process")
const [, , command, ...args] = process.argv
const { writeFileSync } = require("fs")
const { resolve, basename } = require("path")
precondition()
switch (command) {
    case 'create':
        create()
        return
    case 'destroy':
        destroy()
        return
    case 'help':
        log('Valid arguments : create [-f | --force] | destroy')
        return
}



function create() {
    if (args[0] && args[0] !== '--force' && args[0] !== '-f') {
        panic(`unknown argument: ${args[0]}`)
    }

    // check if container named ${CONTAINER_NAME} exist
    if (exec(`docker inspect ${CONTAINER_NAME}`).status === 0) {
        if (args[0] === '--force' || args[0] === '-f') {
            log(`removing existing container ${CONTAINER_NAME} ...`)
            exec(`docker container rm -f ${CONTAINER_NAME}`)
        } else {
            panic(`It seems one container named ${CONTAINER_NAME} already exists! do nothing`)
        }
    }

    // check if the network exist
    if (!getNetworkIdByName(NETWORK)) {
        panic(`No such network: ${networkName}`)
    }

    log("Creating docker volume ...")
    exec(`docker volume rm -f            ${VOLUME_NAME}`)
    tryExec(`docker volume create --name ${VOLUME_NAME}`)

    log("Initializing vpn config ...")
    // -b
    tryExec(`docker run -v ${VOLUME_NAME}:/etc/openvpn --rm ${OPENVPN_IMAGE} ovpn_genconfig -b -u udp://localhost`)
    // -p 172.16.0.0 255.240.0.0

    log("Creating CA (may take sometime) ...")
    tryExec(`docker run -v ${VOLUME_NAME}:/etc/openvpn --rm -i -e "EASYRSA_BATCH=1" -e "EASYRSA_REQ_CN=Default CA" ${OPENVPN_IMAGE} ovpn_initpki nopass`)

    log("Creating client certificate ...")
    tryExec(`docker run -v ${VOLUME_NAME}:/etc/openvpn --rm -i ${OPENVPN_IMAGE} easyrsa build-client-full ${CONTAINER_NAME} nopass`)

    const [networkId, subnet] = [getNetworkIdByName(NETWORK), getSubnet(NETWORK)]

    log(`Create OpenVPN Server container ...`)
    tryExec(`docker create --dns 8.8.8.8 --restart=always -v ${VOLUME_NAME}:/etc/openvpn --name ${CONTAINER_NAME}  -p 1194:1194/udp --network ${networkId} --cap-add=NET_ADMIN ${OPENVPN_IMAGE}`)

    log("Start OpenVPN server container ...")

    tryExec(`docker start ${CONTAINER_NAME}`)

    const configurationFile = resolve(__dirname, `${CONTAINER_NAME}.ovpn`)

    log(`Exporting ovpn configuration file to ${configurationFile} ...`)

    const res = tryExec(`docker run -v ${VOLUME_NAME}:/etc/openvpn --rm ${OPENVPN_IMAGE} ovpn_getclient ${CONTAINER_NAME}`)
    //writeFileSync(configurationFile, res.stdout)
    writeFileSync(configurationFile, res.stdout.replace(/redirect-gateway.*/,
        `route ${subnet}\n`))
    
    note(`
    Done!
    Now you can see the ovpn file ${configurationFile}.
    For Windows user, you can use "OpenVPN GUI for Windows" to import this file.
    Mac OS X user should run command 'open ./${basename(configurationFile)}' and Tunnelblick would import it.
    `.split("\n").map(str => str.trim()).join("\n"))
}

function destroy() {
     // check if container named ${CONTAINER_NAME} exist
    if (exec(`docker inspect ${CONTAINER_NAME}`).status !== 0) 
        panic(`It seems one container named ${CONTAINER_NAME} already exists! do nothing`)
    log(`removing existing container ${CONTAINER_NAME} ...`)
    exec(`docker volume rm -f ${VOLUME_NAME}`)
    exec(`docker container rm -f ${CONTAINER_NAME}`)
    note(`Done!`)
}

/**
 * get network list
 * @returns 
 */
function networkTable() {
    const [head, ...res] = exec(`docker network ls --no-trunc --filter "name=${[NETWORK].join("|")}"`)
        .stdout.split("\n")
        .flatMap(str => str.trim().length === 0 ? [] : [str.trim()])
    return res
}

/**
 * literally, get network id by network name, return null if not found
 * @param {string} name 
 */
function getNetworkIdByName(name) {
    const res = networkTable().find(str => str.indexOf(name) !== -1)
    if (!res) return null
    return res.split(/[ \t]/)[0]
}

/**
 * execute command, and throw exception when command return value !== 0
 * @param {string} command 
 */
function tryExec(command) {
    const res = exec(command)
    if (res.status !== 0)
        throw new Error(res.stderr)
    return res
}

/**
 * execute command
 * @param {string} command 
 * @returns 
 */
function exec(command) {
    return spawnSync(command, null, {
        cwd: process.cwd(),
        env: process.env,
        shell: true,
        stdio: 'pipe',
        encoding: 'utf-8'
    })
}

function log(msg) {
    // green
    console.log('\033[0;32m' + msg + '\033[0m')
}
function note(msg) {
    // bold white
    console.log("\033[1;37m" + msg + '\033[0m')
}
function warn(msg) {
    // yellow
    console.log('\033[0;33m' + msg + '\033[0m')
}
function error(msg) {
    // red
    console.log('\033[0;31m' + msg + '\033[0m')
}

/**
 * something really bad
 * @param {string} msg 
 */
function panic(msg) {
    error(msg)
    process.exit(1)
}

function validCommand(command) {
    return ['create', 'destroy'].includes(command)
}

function precondition() {
    if (!validCommand(command)) {
        note('Valid arguments : create [-f | --force] | destroy')
        process.exit()
    }
    // check if docker is installed
    if (exec('docker').status === 1) {
        panic("Docker client not found! Please check the $PATH or install docker!")
    }
}

/**
 * get network's Subnet, format like "172.17.0.0 255.255.0.0", return null if network not found
 * @param {string} networkId network name or ID
 * @returns 
 */
function getSubnet(networkId) {
    const out = exec(`docker network inspect --format "{{(index .IPAM.Config 0).Subnet}}" ${networkId}`).stdout
    if (!out) return null

    function CDIR2netmask(bitcount) {
        const mask = []
        for (let i = 0; i < 4; i++) {
            const n = Math.min(bitcount, 8)
            mask.push(256 - Math.pow(2, 8 - n))
            bitcount -= n
        }
        return mask.join('.')
    }

    const [ip, bitcount] = out.trim().split("/")
    return `${ip} ${CDIR2netmask(bitcount)}`
}
