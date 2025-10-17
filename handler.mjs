// handler.mjs
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

// --- Timeouts ---
const NAV_TIMEOUT_MS = 20000;
const WAIT_FOR_CONTENT_MS = 15000; // This is the most critical timeout now
const EVAL_TIMEOUT_MS = 5000;
const TOTAL_JOB_TIMEOUT_MS = 30000; // Increased total job time

export const handler = async (event) => {
  const browser = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    defaultViewport: { width: 390, height: 844 },
  });

  let page;
  const watchdog = setTimeout(() => {}, TOTAL_JOB_TIMEOUT_MS);

  try {
    page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36'
    );
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'media', 'font', 'stylesheet'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const handle = (event?.queryStringParameters?.handle || 'x').replace(/^@/, '');
    const url = `https://x.com/${handle}`;

    console.log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {});

    // **MODIFICATION: THE INTELLIGENT WAIT**
    // Instead of waitForSelector, we use waitForFunction.
    // This function will run inside the browser until at least one tweet article appears.
    console.log('Waiting for tweets to be rendered by client-side JavaScript...');
    const TWEET_SELECTOR = 'article[data-testid="tweet"]';
    
    await page.waitForFunction(
      (selector) => document.querySelector(selector),
      { timeout: WAIT_FOR_CONTENT_MS },
      TWEET_SELECTOR
    );

    console.log('Tweets have rendered. Evaluating content...');
    
    const result = await Promise.race([
      page.$$eval(TWEET_SELECTOR, (articles) => {
        console.log("FOR FOKS SAKES")
        // This browser-side code now runs AFTER we know at least one article exists.
        for (const article of articles) {
          const articleText = article.innerText;
          const isPinned = articleText.includes('Pinned') || articleText.includes('Fijado');
          const isPromoted = articleText.includes('Promoted') || articleText.includes('Promocionado');

          if (isPinned || isPromoted) {
            continue;
          }

          const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
          const text = tweetTextEl ? tweetTextEl.innerText.trim() : '';
          
          const timeAnchor = Array.from(article.querySelectorAll('a')).find(
              a => a.href.includes('/status/') && a.querySelector('time')
          );

          if (!timeAnchor) {
            continue;
          }

          const href = timeAnchor.getAttribute('href');
          const time = timeAnchor.querySelector('time')?.getAttribute('datetime');

          return { text, time, href };
        }
        return null;
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('tweet-eval-timeout')), EVAL_TIMEOUT_MS)),
    ]);

    console.log(result)

    if (!result) {
      console.log('Processed articles but found no valid, non-pinned tweet.');
      return { statusCode: 404, body: JSON.stringify({ error: 'No non-pinned tweet found.' }) };
    }

    const { text, time, href } = result;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle,
        tweet_text: text || '',
        tweet_time: time,
        tweet_url: href ? `https://x.com${href}` : null,
      }),
    };
  } catch (e) {
    const msg = e?.message || String(e);
    console.error('An error occurred:', msg);
    // Add a specific message if the waitForFunction times out
    if (msg.includes('Waiting for function failed')) {
        return { statusCode: 504, body: JSON.stringify({ error: 'Timeout: Tweets did not render on the page in time.' }) };
    }
    const isTimeout = /Navigation timeout|tweet-eval-timeout/i.test(msg);
    const body = { error: isTimeout ? 'Timeout fetching tweet data from X.com' : msg };
    return { statusCode: isTimeout ? 504 : 500, body: JSON.stringify(body) };
  } finally {
    
    clearTimeout(watchdog);
    if (page) {
      try {
        page.removeAllListeners('request');
        if (!page.isClosed()) { await page.setRequestInterception(false); }
      } catch {}
    }
    
    const proc = browser?.process?.();
    await Promise.race([browser.close(), new Promise(r => setTimeout(r, 1500))]);
    if (proc && !proc.killed) { try { proc.kill('SIGKILL'); } catch {} }
  }
};