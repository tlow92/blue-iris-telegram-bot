const fs = require('fs').promises;
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');

const Telegraf = require('telegraf');
const Telegram = require('telegraf/telegram');

const { BOT_TOKEN, BLUE_IRIS_URL, BLUE_IRIS_USERNAME, BLUE_IRIS_PASSWORD, PORT } = require('./conf.json');
if(BOT_TOKEN === '' || BLUE_IRIS_URL === '' || BLUE_IRIS_USERNAME === '' || BLUE_IRIS_PASSWORD === '') {
    if(BOT_TOKEN === '') console.warn('BOT_TOKEN has to be specified in conf.json.');
    if(BLUE_IRIS_URL === '') console.warn('BLUE_IRIS_URL has to be specified in conf.json.');
    if(BLUE_IRIS_USERNAME === '') console.warn('BLUE_IRIS_USERNAME has to be specified in conf.json.');
    if(BLUE_IRIS_PASSWORD === '') console.warn('BLUE_IRIS_PASSWORD has to be specified in conf.json.');
    return;
}

const telegram = new Telegram(BOT_TOKEN);
const bot = new Telegraf(BOT_TOKEN);

const server = express();
server.use(bodyParser.urlencoded({
    extended: true
}));
server.use(bodyParser.json());

let session = '';

// On every text message
bot.start((ctx) => {
    const userId = ctx.from.id;
    isAllowed(userId).then((allowed) => {
        if(allowed) {
            saveChatToFile(userId)
            .then((alreadyRegistered) => {
                if(alreadyRegistered) ctx.reply(`You are now registered for updates.`);
                else ctx.reply(`You are already registered.`);
            })
            .catch(() => {

            })
        } else {
            console.warn(`Following Telegram user is trying to access the bot: ${ctx.from.first_name} - ${userId}`);
            console.warn(`Add his id: ${userId} to ALLOWED_USER in conf.json file, if you want to allow him.`);
            ctx.reply(`You are not allowed.`);
        }
    });
});


saveChatToFile = (chatId) => {
    const fileName = 'chats.json';
    return fs.readFile(fileName).then((res) => {
        return JSON.parse(res);
    }).catch((err) => {
        return {
            "chats" : []
        };
    }).then((current) => {
        if(!current.chats.includes(chatId)) {
            current.chats.push(chatId);

            return fs.writeFile(fileName, JSON.stringify(current))
                .then(() => {
                    console.log(JSON.stringify(current));
                    console.log('writing to ' + fileName);
                    return true;
                }).catch((err) => {
                    console.error(err);
                    return false;
                })
        } else {
            return false;
        }
    });
}

isAllowed = (userId) => {
    return fs.readFile('conf.json').then((res) => {
        const { ALLOWED_USER } = JSON.parse(res);
        return ALLOWED_USER.includes(userId)
    });
}

callBI = (req) => {
    if(session != '') {
        req.session = session
    }
    return axios.post(BLUE_IRIS_URL+'/json', req)
}

makeSnapshotAndReturnPath = (camera) => {
    return callBI({
        cmd:"login"
    })
    .then((res) => {
        return res.data
    })
    .then((res) => {
        let hash = crypto.createHash('md5').update(BLUE_IRIS_USERNAME + ':' + res.session + ':' + BLUE_IRIS_PASSWORD).digest("hex")
    
        return callBI({
            cmd:"login",
            session: res.session,
            response: hash
        })
    })
    .then((res) => {
        session = res.data.session;
        if(res.data.result === 'success') {
            return axios.get(BLUE_IRIS_URL + '/cam/' + camera + '/pos=100?session=' + session)
            .then((res) => {
                if(res.data.includes("<body>Ok</body>")){
                    return new Promise((resolve, reject) => {
                        setTimeout(() => {
                            return callBI({
                                "cmd":"cliplist","camera":"Index"
                            }).then((res) => {
                                let tmp = res.data.data.find((el) => {
                                    return el.filesize.includes("Snapshot")
                                });
                                console.log('resolving promise for clip')
                                resolve(BLUE_IRIS_URL + '/clips/' + tmp.path + '?session=' + session);
                            })
                        }, 250)
                    })
                } else {
                    console.log('error when doing snapshot');
                    console.log(res.data);
                    throw Error()
                }
            })
        } else {
            console.log('error when logging into');
            console.log(res.data);
            throw Error()
        }
    })
    .catch((error) => {
        console.log(error)
        return error
    })
}

notifyTelegramUsers = (path) => {
    fs.readFile('chats.json')
        .then((chats) => {
            return JSON.parse(chats).chats;
        }).then((chats) => {
            axios.request({
                responseType: 'arraybuffer',
                url: path,
                method: 'get',
                headers: {
                    'Content-Type': 'image/png',
                },
            }).then((photo) => {
                chats.forEach((userId) => {
                    telegram.sendPhoto(userId, {source: photo.data});
                })
            }).catch((err) => {
                console.log('error when trying to download picture')
                console.log(err)
            })
        })
}

server.get('/get-snapshot', (req, res) => {
    return makeSnapshotAndReturnPath(req.query.camera).then((path) => {
        notifyTelegramUsers(path);
        return res.send('ok')
    })
});


server.listen(PORT, function () {
    console.log(`Blue Iris Alert bot listening on port ${PORT}!`);
    console.log(`1. enter your settings in conf.json and restart`);
    console.log(`2. contact the bot with /start`);
    console.log(`3. check this console output for the userId`);
    console.log(`4. add the userId to the ALLOWED_USER in conf.json`);
    console.log(`5. restart this bot`);
    console.log(`5. Use {ip}:${PORT}/get-snapshot?camera=$CAM in blue iris alert web request to trigger the telegram bot`);
  });

bot.launch()

