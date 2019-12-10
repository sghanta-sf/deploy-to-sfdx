import logger from 'heroku-logger';
import express from 'express';

import ua from 'universal-analytics';
import path from 'path';
import jsforce from 'jsforce';

import { putDeployRequest, getKeys, cdsDelete, cdsRetrieve, cdsPublish, putLead } from '../lib/redisNormal';
import { deployMsgBuilder } from '../lib/deployMsgBuilder';
import { utilities } from '../lib/utilities';

import { deployRequest } from '../lib/types';
import { CDS } from '../lib/CDS';

const app: express.Application = express();

const port = process.env.PORT || 8443;

app.listen(port, () => {
    logger.info(`Example app listening on port ${port}!`);
});

// app.use(favicon(path.join(__dirname, 'assets/favicons', 'favicon.ico')));
app.use(express.static('dist'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.post(
    '/trial',
    wrapAsync(async (req, res, next) => {
        const message = await commonDeploy(req, '/trial');
        logger.debug('trial request', message);
        await putLead(req.body);
        res.redirect(`/deploying/trial/${message.deployId.trim()}`);
    })
);

app.post(
    '/delete',
    wrapAsync(async (req, res, next) => {
        await cdsDelete(req.body.deployId);
        res.send({ redirectTo: '/deleteConfirm' });
    })
);

app.get(
    '/launch',
    wrapAsync(async (req, res, next) => {
        // allow repos to require the email parameter
        if (req.query.email === 'required') {
            return res.redirect(`/userinfo?template=${req.query.template}`);
        }

        const message = await commonDeploy(req, '/launch');
        return res.redirect(`/deploying/deployer/${message.deployId.trim()}`);
    })
);

app.get(['/', '/error', '/deploying/:format/:deployId', '/userinfo', '/byoo', '/testform', '/deleteConfirm'], (req, res, next) => {
    res.sendFile('index.html', { root: path.join(__dirname, '../../../dist') });
});

app.get(
    '/pools',
    wrapAsync(async (req, res, next) => {
        const keys = await getKeys();
        res.send(keys);
    })
);

app.get(
    '/results/:deployId',
    wrapAsync(async (req, res, next) => {
        const results = await cdsRetrieve(req.params.deployId);
        res.send(results);
    })
);

app.get('/favicons/favicon.ico', (req, res, next) => {
    res.sendFile('favicon.ico', { root: path.join(__dirname, '../../../dist/resources/favicons') });
});

app.get('/service-worker.js', (req, res, next) => {
    res.sendStatus(200);
});

app.get(
    '/authUrl',
    wrapAsync(async (req, res, next) => {
        const byooOauth2 = new jsforce.OAuth2({
            redirectUri: process.env.BYOO_CALLBACK_URI || `http://localhost:${port}/token`,
            clientId: process.env.BYOO_CONSUMERKEY,
            clientSecret: process.env.BYOO_SECRET,
            loginUrl: req.query.base_url
        });
        res.send(
            byooOauth2.getAuthorizationUrl({
                scope: 'api id web openid',
                state: JSON.stringify(req.query)
            })
        );
    })
);

app.get(
    '/token',
    wrapAsync(async (req, res, next) => {
        const state = JSON.parse(req.query.state);

        const byooOauth2 = new jsforce.OAuth2({
            redirectUri: process.env.BYOO_CALLBACK_URI || `http://localhost:${port}/token`,
            clientId: process.env.BYOO_CONSUMERKEY,
            clientSecret: process.env.BYOO_SECRET,
            loginUrl: state.base_url
        });
        const conn = new jsforce.Connection({ oauth2: byooOauth2 });
        const userinfo = await conn.authorize(req.query.code);

        // put the request in the queue
        const message = await commonDeploy(
            {
                query: {
                    template: state.template
                },
                byoo: {
                    accessToken: conn.accessToken,
                    instanceUrl: conn.instanceUrl,
                    username: userinfo.id,
                    orgId: userinfo.organizationId
                }
            },
            'byoo'
        );
        return res.redirect(`/deploying/deployer/${message.deployId.trim()}`);
    })
);

app.get('*', (req, res, next) => {
    setImmediate(() => {
        next(new Error(`Route not found: ${req.url} on action ${req.method}`));
    });
});

app.use((error, req, res, next) => {
    if (process.env.UA_ID) {
        const visitor = ua(process.env.UA_ID);
        visitor.event('Error', req.query.template).send();
    }
    logger.error(`request failed: ${req.url}`);
    logger.error(error);
    return res.redirect(`/error?msg=${error}`);
});

function wrapAsync(fn: any) {
    return function(req, res, next) {
        // Make sure to `.catch()` any errors and pass them along to the `next()`
        // middleware in the chain, in this case the error handler.
        fn(req, res, next).catch(next);
    };
}

const commonDeploy = async (req, url: string) => {
    const message: deployRequest = deployMsgBuilder(req);

    if (message.visitor) {
        message.visitor.pageview(url).send();
        if (typeof message.template === 'string') {
            message.visitor.event('Repo', message.template).send();
        }
    }

    utilities.runHerokuBuilder();
    await putDeployRequest(message);
    await cdsPublish(
        new CDS({
            deployId: message.deployId
        })
    );
    return message;
};
// process.on('unhandledRejection', e => {
//     logger.error('this reached the unhandledRejection handler somehow:', e);
// });
