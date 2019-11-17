var fs = require('fs');
var express = require('express');
var bodyParser = require('body-parser')
const axios = require('axios')
const crypto = require('crypto')

const Telegraf = require('telegraf')
const Telegram = require('telegraf/telegram')

const telegram = new Telegram(process.env.BOT_TOKEN)
const bot = new Telegraf(process.env.BOT_TOKEN)
const allowedUsers = [];

const server = express();
server.use(bodyParser.urlencoded({
    extended: true
}));
server.use(bodyParser.json());

let session = ''
const blueIrisUrl = process.env.BLUE_IRIS_URL;
const blueIrisUsername = process.env.BLUE_IRIS_USERNAME;
const blueIrisPassword = process.env.BLUE_IRIS_PASSWORD;
const port = 3000

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
            ctx.reply(`You are not allowed.`);
        }
    });
});


saveChatToFile = (chatId) => {
    const fileName = './chats.json';

    return new Promise((resolve, reject) => {
        fs.exists(fileName, (exists) => {
            let file = {
                "chats" : []
            }
            if(exists) file = require(fileName);
            let newChats = file.chats;
            if(!newChats.includes(chatId)) {
                newChats.push(chatId);
                file.chats = newChats;
            
                fs.writeFile(fileName, JSON.stringify(file), function (err) {
                    if (err) reject(err)
                    console.log(JSON.stringify(file));
                    console.log('writing to ' + fileName);
                    resolve(true)
                });
            } else {
                resolve(false)
            }
        })
    
    })
}

isAllowed = (userId) => {
    return new Promise((resolve, reject) => {
        if(allowedUsers.includes(userId.toString())) {
            resolve(true)
        }
        reject(false)
    })
}

callBI = (req) => {
    if(session != '') {
        req.session = session
    }
    return axios.post(blueIrisUrl+'/json', req)
}

makeSnapshotAndReturnPath = (camera) => {
    return callBI({
        cmd:"login"
    })
    .then((res) => {
        return res.data
    })
    .then((res) => {
        let hash = crypto.createHash('md5').update(blueIrisUsername+':'+res.session+':'+blueIrisPassword).digest("hex")
    
        return callBI({
            cmd:"login",
            session: res.session,
            response: hash
        })
    })
    .then((res) => {
        session = res.data.session;
        if(res.data.result === 'success') {
            return axios.get(blueIrisUrl+'/cam/'+camera+'/pos=100?session='+session)
            .then((res) => {
                if(res.data.includes("<body>Ok</body>")){
                    return new Promise((resolve, reject) => {
                        setTimeout(() => {
                            return callBI({
                                "cmd":"cliplist","camera":"Index"
                            }).then((res) => {
                                let tmp = res.data.data.find((el) => {
                                    return el.filesize.includes("Snapshot")
                                })
                                resolve((blueIrisUrl+'/clips/'+tmp.path+'?session='+session))
                            })
                        }, 250)
                    })
                } else {
                    throw Error()
                }
            })
        } else {
            throw Error
        }
    })
    .catch((error) => {
        console.log(error)
        return error
    })
}

notifyTelegramUsers = (msg) => {
    var file = require('./chats.json');
    file.chats.forEach((userId) => {
        telegram.sendPhoto(userId, msg) 
    })
}

server.get('/get-snapshot', (req, res) => {
    return makeSnapshotAndReturnPath(req.query.camera).then((path) => {
        notifyTelegramUsers(path)
        return res.send('ok')
    })
});


server.listen(port, function () {
    console.log(`Blue Iris Alert bot listening on port ${port}!`);
    console.log(`1. contact the bot with /start`);
    console.log(`2. check this console output for the userId`);
    console.log(`3. add the userId to the global variable allowedUsers`);
    console.log(`4. restart this bot`)
    console.log(`5. Use {ip}:${port}/get-snapshot?camera=$CAM in blue iris alert web request to trigger the telegram bot`);
  });

bot.launch()

