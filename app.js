import needle from 'needle';
import * as dotenv from 'dotenv';
import { TwitterApi } from 'twitter-api-v2';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
dotenv.config();
const app = express();
app.use(bodyParser.json());
app.use(cors());
const token = process.env['BEARER_TOKEN'];
const PORT = process.env.PORT || 4000;
import puppeteer from 'puppeteer';
import {
  getFirstTweet,
  getTextWithoutMediaURL,
  getTweetsInThread
} from './twitterService.js';
const rulesURL = 'https://api.twitter.com/2/tweets/search/stream/rules';
const streamURL =
  'https://api.twitter.com/2/tweets/search/stream?tweet.fields=attachments,author_id,conversation_id,entities,id,in_reply_to_user_id,referenced_tweets,reply_settings,source,text,withheld&expansions=in_reply_to_user_id,referenced_tweets.id,referenced_tweets.id.author_id';
const openWebsite = async (conversationId) => {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto('https://twitterthreadbot.netlify.app/', {
      waitUntil: 'load'
    });
    console.log(page.url());
    await page.type('input[id=input-conversation]', conversationId, {
      delay: 20
    });
    await page.click('#btn-getPdf');
    await page.waitForSelector('#url');
    let element = await page.$('#url');
    let value = await page.evaluate((el) => el.textContent, element);
    console.log('New Page URL:', value);
    return value;
  } catch (e) {
    console.log(e);
  }
};
const rules = [
  {
    value: '@threadbot0'
  }
];

async function getAllRules() {
  const response = await needle('get', rulesURL, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  if (response.statusCode !== 200) {
    console.log('Error:', response.statusMessage, response.statusCode);
    throw new Error(response.body);
  }
  return response.body;
}

async function deleteAllRules(rules) {
  if (!Array.isArray(rules.data)) {
    return null;
  }
  const ids = rules.data.map((rule) => rule.id);
  const data = {
    delete: {
      ids: ids
    }
  };

  const response = await needle('post', rulesURL, data, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    }
  });
  if (response.statusCode !== 200) {
    throw new Error(response.body);
  }
  return response.body;
}

async function setRules() {
  const data = {
    add: rules
  };

  const response = await needle('post', rulesURL, data, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    }
  });

  if (response.statusCode !== 201) {
    throw new Error(response.body);
  }

  return response.body;
}

function streamConnect(retryAttempt) {
  const stream = needle.get(streamURL, {
    headers: {
      'User-Agent': 'v2FilterStreamJS',
      Authorization: `Bearer ${token}`
    },
    timeout: 20000
  });

  stream
    .on('data', async (data) => {
      try {
        console.log('Server is running');
        let json;
        if (data) {
          json = JSON.parse(data);
          // console.log(json);
          let url;
          if (json.data.text.includes('Grab this')) {
            url = await openWebsite(json.data.conversation_id);
            console.log(url);
          }
          if (url !== undefined) {
            console.log('url not undefined');
            main('Here is the pdf ' + url, json.data.id);
          }
        }
        // A successful connection resets retry count.
        retryAttempt = 0;
      } catch (e) {
        if (
          data.detail ===
          'This stream is currently at the maximum allowed connection limit.'
        ) {
          process.exit(1);
        } else {
          // Keep alive signal received. Do nothing.
        }
      }
    })
    .on('err', (error) => {
      console.log(err, 'Error!!');
      if (error.code !== 'ECONNRESET') {
        process.exit(1);
      } else {
        // This reconnection logic will attempt to reconnect when a disconnection is detected.
        // To avoid rate limits, this logic implements exponential backoff, so the wait time
        // will increase if the client cannot reconnect to the stream.
        setTimeout(() => {
          console.warn('A connection error occurred. Reconnecting...');
          streamConnect(++retryAttempt);
        }, 2 ** retryAttempt);
      }
    });
  return stream;
}

async function main(text, inreplyId) {
  console.log(text, inreplyId, 'inside main');
  try {
    const client = new TwitterApi({
      appKey: process.env['APP_KEY'],
      appSecret: process.env['APP_SECRET'],
      accessToken: process.env['ACCESS_TOKEN'],
      accessSecret: process.env['ACCESS_SECRET']
    });
    const rwClient = client.readWrite;
    const res = await rwClient.v1.reply(text, inreplyId);
    console.log(res);
  } catch (e) {
    console.log(e);
  }
}
(async () => {
  let currentRules;
  try {
    currentRules = await getAllRules();
    await deleteAllRules(currentRules);
    await setRules();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
  streamConnect(0);
})();
app.get('/', (req, res) => {
  res.send('This is stream listener twitter bot');
});
app.get('/conversation/:id', async (req, res) => {
  try {
    const firstTweet = await getFirstTweet(req.params.id);
    const tweetsInThread = await getTweetsInThread(
      req.params.id,
      firstTweet.username
    );
    const allMedia = tweetsInThread?.includes?.media;
    const threadTweets = [...tweetsInThread?.data].reverse().map((tweet) => ({
      text: getTextWithoutMediaURL(tweet.text),
      media:
        tweet?.attachments?.media_keys.map(
          (key) => allMedia?.filter((media) => media.media_key === key)[0]
        ) || [],
      id: tweet.id
    }));
    const allTweets = [firstTweet, ...threadTweets];
    res.send(allTweets);
  } catch (error) {
    return res
      .status(500)
      .send({ msg: 'Could not fetch conversation' + error });
  }
});
app.listen(PORT, () => {
  console.log(`The application is listening on port ${PORT}!`);
});
