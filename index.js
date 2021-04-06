'use strict';

const {Key} = require("@google-cloud/datastore");
const {Datastore} = require('@google-cloud/datastore');

const datastore = new Datastore();

const kind = 'users';


const {WebClient} = require('@slack/web-api');
const web = new WebClient(process.env.SLACK_TOKEN);

exports.timer = async (req, res) => {
    const https = require('https');

    const query = datastore.createQuery(kind);
    const [users] = await datastore.runQuery(query);
    await Promise.all(
        users.map(user => syncOura(user))
    );

    res.status(200).end();

    async function syncOura(user) {
        https.get('https://api.ouraring.com/v1/readiness', {headers: {Authorization: `Bearer ${user.ouraToken}`}}, async res => {
            try {
                let body = '';
                res.setEncoding('utf-8');
                for await (const chunk of res) {
                    body += chunk;
                }
                // console.log('RESPONSE', body);
                body = JSON.parse(body)
                const readiness = body.readiness
                if (readiness.length > 0) {
                    const slackUserId = user[Key];
                    const score = readiness[readiness.length - 1].score;
                    await setReadiness(slackUserId, score);
                }
            } catch (e) {
                console.log('ERROR', e);
            }
        });
    }

    async function setReadiness(slackUserId, score) {
        let statusEmoji = ':shrug:';
        if (score > 80) {
            statusEmoji = ':sunny:';
        } else if (score < 40) {
            statusEmoji = ':imp:';
        }

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        await web.users.profile.set(
            {
                profile: {
                    "status_text": `Oura: ${score}`,
                    "status_emoji": statusEmoji,
                    "status_expiration": Math.floor(tomorrow.getTime() / 1000)
                },
                user: slackUserId
            }
        )
    }

};

exports.setup = async (req, res) => {
    if (req.method === "POST" && req.is('application/x-www-form-urlencoded')) {
        console.log(req.body)
        const text = req.body.text;

        const userId = req.body.user_id;

        const userKey = datastore.key([kind, userId]);
        if (text.toLowerCase().startsWith("setup")) {
            const userResponse = await web.users.info({user: userId});
            console.log(userResponse);
            const timeZone = userResponse.user.tz_offset;
            const ouraToken = text.split(' ')[1];

            const user = {
                key: userKey,
                data: {
                    ouraToken,
                    timeZone
                }
            };

            await datastore.save(user);

            res.status(200).send('You\'re setup! We\'ll sync your oura readiness score to slack in the morning. Monday through Friday').end();
        } else if (text.toLowerCase().startsWith("help")) {
            const record = (await datastore.get(userKey))[0];
            let text = 'Say setup followed by your oura personal access token. ';
            if (record) {
                text = text + 'You are currently setup already, not working? Try updating your access token using setup';
            } else {
                text = text + 'You are not setup yet';
            }
            res.status(200).send(text).end();

        } else {
            res.status(200).send('Unknown command, either say setup followed by your oura personal access token to set yourself up').end();
        }
    } else {
        res.status(400).end();
    }
};


exports.setupApp = async (req, res) => {
    const code = req.params.code;
    const web = new WebClient(code);
    const oauth = await web.oauth.v2.access({
        client_id: "1898202498695.1919145303956",
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code: code
    });
    console.log(oauth);
    res.status(200).end();
};
