const fs = require('fs').promises;
const oldfs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');

const Telegraf = require('telegraf');
const Telegram = require('telegraf/telegram');

readConfFile = () => {
    try {
        return JSON.parse(oldfs.readFileSync(`${__dirname}/conf.json`, 'utf8'));
    } catch {
        const defaultJson = {
            "BOT_TOKEN":  "",
            "BLUE_IRIS_URL":  "",
            "BLUE_IRIS_USERNAME":  "",
            "BLUE_IRIS_PASSWORD":  "",
            "PORT": "3000",
            "ALLOWED_USER": []
        };

        fs.writeFile(`${__dirname}/conf.json`, JSON.stringify(defaultJson));

        return defaultJson;
    }
};

const { BOT_TOKEN, BLUE_IRIS_URL, BLUE_IRIS_USERNAME, BLUE_IRIS_PASSWORD, PORT } = readConfFile();

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

let globalSession = '';

// On every text message
bot.start((ctx) => {
    ctx.reply('Use /snapshot or /gif to opt in for alerts.');
});

bot.command('snapshot', (ctx) => {
    optIn(ctx.from.id, 'snapshot').then((state) => {
        if(state) ctx.reply('You are now getting snapshot on alerts.')
        else ctx.reply('You are not receiving snapshot anymore.')
    }).catch((err) => {
        console.log(err)
        console.warn(`Following Telegram user is trying to access the bot: ${ctx.from.first_name} - ${ctx.from.id}`);
        console.warn(`Add his id: ${ctx.from.id} to ALLOWED_USER in conf.json file, if you want to allow him.`);
        ctx.reply(`You are not allowed.`);
    })
});

bot.command('gif', (ctx) => {
    optIn(ctx.from.id, 'gif').then((state) => {
        if(state) ctx.reply('You are now getting gifs on alerts.')
        else ctx.reply('You are not receiving gifs anymore.')
    }).catch((err) => {
        console.log(err)
        console.warn(`Following Telegram user is trying to access the bot: ${ctx.from.first_name} - ${ctx.from.id}`);
        console.warn(`Add his id: ${ctx.from.id} to ALLOWED_USER in conf.json file, if you want to allow him.`);
        ctx.reply(`You are not allowed.`);
    })
});

optIn = (userId, type) => {
    return isAllowed(userId).then((allowed) => {
        if(allowed) {
            return saveChatToFile(userId, type)
        } else {
            throw new Error();
        }
    });
}

saveChatToFile = (chatId, type) => {
    const fileName = 'chats.json';
    return fs.readFile(fileName).then((res) => {
        return JSON.parse(res);
    }).catch((err) => {
        return {
            'gif': [],
            'snapshot': []
        };
    }).then((current) => {
        let result;
        if(!current[type].includes(chatId)) {
            current[type].push(chatId);
            result = true;
        } else {
            current[type] = current[type].filter((id) => (id !== chatId));
            result = false;
        }
        return fs.writeFile(fileName, JSON.stringify(current))
          .then(() => {
              console.log(JSON.stringify(current));
              console.log('writing to ' + fileName);
              return result;
          }).catch((err) => {
              console.log(err)
              throw new Error();
          })
    });
};

isAllowed = (userId) => {
    return fs.readFile('conf.json').then((res) => {
        const { ALLOWED_USER } = JSON.parse(res);
        return ALLOWED_USER.includes(userId)
    });
};

callBI = (req) => {
    if(globalSession !== '') {
        req.session = globalSession
    }
    return axios.post(BLUE_IRIS_URL+'/json', req)
};

login = () => {
    globalSession = '';
    return callBI({
        cmd:"login"
    })
      .then((res) => {
          return res.data.session
      })
      .then((session) => {
          let hash = crypto.createHash('md5').update(BLUE_IRIS_USERNAME + ':' + session + ':' + BLUE_IRIS_PASSWORD).digest("hex")
          globalSession = session;
          return callBI({
              cmd:"login",
              response: hash
          })
      })
}

const downloadImage = async (name, url) => {
    return await axios.request({
        responseType: 'arraybuffer',
        url: url,
        method: 'get',
        headers: {
            'Content-Type': 'image/png',
        },
    }).then(async (res) => {
        return await fs.writeFile(name, res.data).then(async () => {
            return await new Promise((resolve, reject) => {
                setTimeout(() => {
                    resolve(true)
                }, 500);
            });
        });
    }).catch(async (err) => {
        return false;
    })
};

makeGifFromStreamAndReturnPath = async (camera) => {
    function sequence(tasks) {
        return tasks.reduce((promise, task) => promise.then(() => downloadImage(task.name, task.url)), Promise.resolve());
    }

    return login().then(async () => {
        const url = `${BLUE_IRIS_URL}/image/${camera}/?session=${globalSession}`;

        return await fs.mkdir('images').then(async () => {}).catch(async () => {}).then(async () => {
            let promises = [];

            for(let i = 0; i < 10; i++) {
                promises.push({name: `${__dirname}/images/image_${i}.jpg`, url: url});
            }

            return await sequence(promises)
        });
    }).then(() => {
        const animation = new Promise((resolve, reject) => {
            const animation = `${__dirname}/images/animation.mp4`;
            ffmpeg(`${__dirname}/images/image_%d.jpg`)
              .withInputFps(2)
              .save(animation)
              .on('end', function() {
                  resolve(animation);
              })
              .run();
        })

        return animation;
    });
}

getSnapshotAndReturnPath = (camera) => {
    return login()
    .then((res) => {
        if(res.data.result === 'success') {
            const url = `${BLUE_IRIS_URL}/image/${camera}/?session=${globalSession}`;
            const filename = `${__dirname}/images/snapshot.jpg`;
            return downloadImage(filename, url).then(() => {
                return filename;
            })
        } else {
            throw Error()
        }
    })
    .catch((error) => {
        return error
    })
}

sendTelegramSnapshot = (path) => {
    fs.readFile('chats.json')
        .then((chats) => {
            return JSON.parse(chats);
        }).then((chats) => {
            fs.readFile(path).then((photo) => {
                chats.snapshot.forEach((userId) => {
                    telegram.sendPhoto(userId, {source: photo});
                })
            })
        })
}

sendTelegramGif = (path) => {
    fs.readFile('chats.json')
      .then((chats) => {
          return JSON.parse(chats);
      }).then((chats) => {
        fs.readFile(path).then((photo) => {
            chats.gif.forEach((userId) => {
                telegram.sendAnimation(userId, {source: photo});
            })
        })
    })
}

server.get('/snapshot', (req, res) => {
    if(req.query.camera) {
      const snapshot = getSnapshotAndReturnPath(req.query.camera).then((path) => {
        sendTelegramSnapshot(path);
      })
      const gif = makeGifFromStreamAndReturnPath(req.query.camera).then((path) => {
        sendTelegramGif(path);
      });

      return Promise.all([snapshot, gif]).then(() => {
        return res.send('ok')
      })
    } else {
        return res.send('params missing')
    }
});


server.listen(PORT, function () {
    console.log(`Blue Iris Alert bot listening on port ${PORT}!`);
    console.log(`1. enter your settings in conf.json and restart`);
    console.log(`2. contact the bot with /start`);
    console.log(`3. check this console output for the userId`);
    console.log(`4. add the userId to the ALLOWED_USER in conf.json`);
    console.log(`5. restart this bot`);
    console.log(`5. Use {ip}:${PORT}/snapshot?camera=$CAM in blue iris alert web request to get a snapshot`);
    console.log(`5. Use {ip}:${PORT}/gif?camera=$CAM in blue iris alert web request to get a gif`);
  });

bot.launch();
