// Tests the Gemini attending end to end with nobody at the microphone.
//
//   node dev/ask.mjs [--url http://localhost:4747] [--shots] ["a question" "another question" ...]
//   node dev/ask.mjs --dry      no key needed: a stand-in session answers, to check this script and the page
//
// For each question it:
//   1. speaks it with macOS `say`, straight to 16 kHz 16-bit mono (the format Gemini Live takes),
//   2. holds the talk button in the page, feeds the recording down the same path the microphone uses, at
//      the pace it was spoken, and lets go,
//   3. watches what comes back: the question appearing on the card, the answer captions, the attending's
//      voice and any tool calls,
// and prints a line per check. Exit code 0 only if every question was heard and answered.
//
// Needs GEMINI_API_KEY in vision/.env.local. This script never reads or prints it: it only asks the local
// server whether a key is configured. Run the app first (npm run dev).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const base = option('url', 'http://localhost:4747').replace(/\/$/, '');
const shots = args.includes('--shots');
const dry = args.includes('--dry');
const given = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--url');

// Each question says what should happen besides a spoken answer.
const QUESTIONS = given.length > 0
  ? given.map((text) => ({ text, expectTool: null }))
  : [
      { text: 'What is the red zone next to the wound?', expectTool: /highlight_structure|show_answer_card/ },
      { text: 'How far apart should my sutures be?', expectTool: null },
      { text: 'Go to the next step please.', expectTool: /next_step|go_to_step/ },
      { text: 'Can you repeat this step for me?', expectTool: /repeat_step/ },
      { text: 'Look at my view. Can you see the wound?', expectTool: /look_at_view/ },
    ];

const say = (text) => {
  const file = path.join(os.tmpdir(), `viper-ask-${process.pid}.wav`);
  execFileSync('say', ['-o', file, '--data-format=LEI16@16000', text]);
  const wav = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  // The samples start after the "data" chunk header.
  const at = wav.indexOf(Buffer.from('data'));
  const pcm = at >= 0 ? wav.subarray(at + 8) : wav.subarray(44);
  // A short silence either side, as a person leaves when holding a button.
  const pad = Buffer.alloc(16000 * 2 * 0.3);
  return Buffer.concat([pad, pcm, pad]);
};

const config = await fetch(`${base}/api/config`).then((r) => r.json()).catch(() => null);
if (!config) {
  console.log(`VIPER Vision is not running at ${base}. Start it with: npm run dev`);
  process.exit(2);
}
if (dry) {
  console.log('DRY RUN: a stand-in session answers. This checks the script and the page, not Gemini.');
} else if (!config.gemini?.configured) {
  console.log('GEMINI_API_KEY is not set, so there is nothing to test yet.');
  console.log('Put it in vision/.env.local (cp .env.example .env.local); the server picks it up without a restart.');
  process.exit(2);
}
if (!dry) console.log(`Model: ${config.gemini.model}`);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const consoleLines = [];
page.on('console', (m) => { if (/attending|gemini|live/i.test(m.text())) consoleLines.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });
page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message.slice(0, 200)}`));

// The anatomy step, so "the red zone" is on screen; no idle screen, no auto reset while we talk.
await page.goto(`${base}/?input=sim&sound=0&step=anatomy&attract=0&idle=0&done=0${dry ? '&attending=0' : ''}`);

// Record everything the Live session sends back, by kind.
await page.waitForFunction(() => window.__viper && window.__viper.brain, null, { timeout: 15000 });
await page.evaluate(() => {
  const brain = window.__viper.brain;
  const log = (window.__askLog = { heard: '', said: '', audioBytes: 0, tools: [], turns: 0, states: [] });
  const handle = brain.handleMessage.bind(brain);
  brain.handleMessage = (message) => {
    const content = message.serverContent;
    if (content?.inputTranscription?.text) log.heard += content.inputTranscription.text;
    if (content?.outputTranscription?.text) log.said += content.outputTranscription.text;
    for (const part of content?.modelTurn?.parts || []) {
      if (part.inlineData?.data) log.audioBytes += Math.floor(part.inlineData.data.length * 0.75);
    }
    for (const call of message.toolCall?.functionCalls || []) log.tools.push(`${call.name}(${JSON.stringify(call.args || {})})`);
    if (content?.turnComplete) log.turns += 1;
    return handle(message);
  };
});

if (dry) {
  // A stand-in for the Live session: it takes what the page sends and, when a question ends, answers the
  // way Gemini does (the words heard, a tool call, speech, the words spoken, end of turn).
  await page.evaluate(() => {
    const brain = window.__viper.brain;
    window.__sent = [];
    brain.wanted = true;
    brain.manualTurns = true;
    brain.session = {
      sendRealtimeInput(message) {
        const kind = Object.keys(message)[0];
        window.__sent.push(kind);
        if (kind === 'activityEnd') setTimeout(() => window.__reply && window.__reply(), 400);
      },
      sendToolResponse() { window.__sent.push('toolResponse'); },
      sendClientContent() {},
      close() {},
    };
    brain.setState('listening');
  });
}

const state = () => page.evaluate(() => ({ state: window.__viper.brain.state, detail: window.__viper.brain.detail, ...window.__viper.brain.sessionInfo }));

// Turn the attending on (it starts by itself when a key is configured; G is the manual way) and wait for it.
let info = await state();
if (info.state === 'off') {
  await page.evaluate(() => window.__viper.brain.start());
}
const deadline = Date.now() + 45000;
while (Date.now() < deadline) {
  info = await state();
  if (info.connected && info.state === 'listening') break;
  await page.waitForTimeout(500);
}
if (!(info.connected && info.state === 'listening')) {
  console.log(`FAIL  the Live session did not open: state "${info.state}" ${info.detail ? `(${info.detail})` : ''}`);
  console.log(consoleLines.slice(-12).join('\n'));
  await browser.close();
  process.exit(1);
}
const LEVELS = ['0 = everything (tools, session features, model-locked token)', '1 = plain tools, unlocked token', '2 = no tools'];
console.log(`Session open. Compatibility level ${LEVELS[info.level] || info.level}; ${info.talkMode === 'push' ? `push-to-talk (${info.manualTurns ? 'we mark each question' : 'audioStreamEnd'})` : 'open microphone'}.`);
if (info.level === 2) console.log('NOTE  level 2 means the session was refused with tools: tool calls cannot fire.');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
};

for (let q = 0; q < QUESTIONS.length; q++) {
  const { text, expectTool } = QUESTIONS[q];
  console.log(`\nQ${q + 1}  "${text}"`);
  const pcm = say(text);
  const stepBefore = await page.evaluate(() => window.__viper.scene.procedure.step.id);
  await page.evaluate(() => { const l = window.__askLog; l.heard = ''; l.said = ''; l.audioBytes = 0; l.tools = []; l.turns = 0; });

  if (dry) {
    const tool = [
      { name: 'highlight_structure', args: { structure: 'radial_artery' } }, null, { name: 'next_step', args: {} },
      { name: 'repeat_step', args: {} }, { name: 'look_at_view', args: {} },
    ][q] || null;
    await page.evaluate(({ question, tool }) => {
      window.__sent.length = 0;
      window.__reply = () => {
        const brain = window.__viper.brain;
        brain.handleMessage({ serverContent: { inputTranscription: { text: question } } });
        if (tool) brain.handleMessage({ toolCall: { functionCalls: [{ id: 't1', ...tool }] } });
        const silence = btoa(String.fromCharCode(...new Uint8Array(24000)));
        brain.handleMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: silence } }] } } });
        brain.handleMessage({ serverContent: { outputTranscription: { text: 'This is the stand-in answer to the question that was asked.' } } });
        brain.handleMessage({ serverContent: { turnComplete: true } });
      };
    }, { question: text, tool });
  }

  // Hold the talk button, speak, let go.
  await page.evaluate(() => window.__viper.brain.talkDown());
  const chunkBytes = 16000 * 2 * 0.1; // 100 ms
  const started = Date.now();
  for (let off = 0, n = 0; off < pcm.length; off += chunkBytes, n++) {
    const chunk = pcm.subarray(off, Math.min(pcm.length, off + chunkBytes)).toString('base64');
    await page.evaluate((data) => window.__viper.brain.injectSpeech(data), chunk);
    const due = started + (n + 1) * 100;
    if (due > Date.now()) await page.waitForTimeout(due - Date.now());
  }
  await page.evaluate(() => { window.__viper.brain.talkUp(); });

  // Wait for the turn to finish (or give up after 25 s), then let the card finish typing.
  const until = Date.now() + 25000;
  let log = null;
  let shotTaken = false;
  while (Date.now() < until) {
    await page.waitForTimeout(400);
    log = await page.evaluate(() => ({ ...window.__askLog }));
    if (shots && !shotTaken && log.said.length > 40) {
      shotTaken = true;
      await page.waitForTimeout(1500);
      const file = path.resolve(here, '..', 'shots', `ask-q${q + 1}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await page.screenshot({ path: file });
    }
    if (log.turns > 0 && Date.now() - started > pcm.length / 32 + 1500) break;
  }
  await page.waitForTimeout(1200);
  const card = await page.evaluate(() => ({
    question: document.querySelector('.gem__q')?.textContent || '',
    answer: document.querySelector('.gem__a')?.textContent || '',
    up: window.__viper.panel.isOnline,
    step: window.__viper.scene.procedure.step.id,
    highlight: window.__viper.scene.highlight.structure,
  }));
  await page.evaluate(() => window.__viper.brain.injectSpeech(''));

  if (dry) {
    const sent = await page.evaluate(() => window.__sent.join(' ').replace(/(audio ?)+/g, (m) => `audio x${m.trim().split(' ').length} `));
    check(/^activityStart audio x\d+ activityEnd/.test(sent), 'sent to the session', sent.trim());
  }
  check(log.heard.trim().length > 0, 'heard', log.heard.trim() || 'no transcript of the question came back');
  check(card.question.trim().length > 2, 'question card', card.question.trim() || 'the question did not appear on the card');
  check(card.answer.trim().length > 0, 'answer captions', card.answer.trim().slice(0, 140) || 'no answer text on the card');
  check(log.audioBytes > 0, 'voice', log.audioBytes > 0 ? `${(log.audioBytes / 48000).toFixed(1)} s of speech` : 'no audio came back');
  if (expectTool) {
    const fired = log.tools.some((t) => expectTool.test(t));
    check(fired, 'tool call', log.tools.join(', ') || `none (wanted ${expectTool.source})`);
  } else if (log.tools.length) {
    console.log(`   info  tool calls: ${log.tools.join(', ')}`);
  }
  if (card.step !== stepBefore) console.log(`   info  the procedure moved: ${stepBefore} -> ${card.step}`);
  if (card.highlight) console.log(`   info  highlighted: ${card.highlight}`);
  await page.waitForTimeout(1500);
}

// ---- Hands-free: "Hey Gemini" opens the question and a pause ends it. Chrome's recogniser needs a real
// microphone and Google's speech service, so what it would report is fed in here; everything after that
// (the turn opening, the audio, the answer, the panel) is the real path.
{
  const question = 'how many sutures are planned';
  console.log(`\nHands-free  "Hey Gemini, ${question}?"`);
  const pcm = say(`Hey Gemini, ${question}?`);
  await page.evaluate(() => { const l = window.__askLog; l.heard = ''; l.said = ''; l.audioBytes = 0; l.tools = []; l.turns = 0; });
  if (dry) {
    await page.evaluate((heard) => {
      window.__reply = () => {
        const brain = window.__viper.brain;
        brain.handleMessage({ serverContent: { inputTranscription: { text: heard } } });
        brain.handleMessage({ serverContent: { outputTranscription: { text: 'Five, eight millimetres apart.' } } });
        brain.handleMessage({ serverContent: { turnComplete: true } });
      };
    }, `Hey Gemini, ${question}?`);
  }
  const feed = (texts, final) => page.evaluate(({ texts, final }) => window.__viper.brain.wake.feed(texts, final), { texts, final });
  const talking = () => page.evaluate(() => window.__viper.brain.talking);

  await feed(['so this panel is gemini'], true);
  check(!(await talking()), 'talk about Gemini does not open a question');

  // The phrase with nothing after it (said in passing, or misheard): the panel listens, then goes back to
  // Ready by itself, without ever saying it is thinking.
  if (dry) await page.evaluate(() => { window.__reply = null; });
  await feed(['so this panel is gemini', 'hey gemini'], true);
  const listened = await page.evaluate(() => document.querySelector('.gem')?.dataset.state);
  let sawThinking = false;
  for (let i = 0; i < 16 && (await talking()); i++) {
    await page.waitForTimeout(500);
    if ((await page.evaluate(() => document.querySelector('.gem')?.dataset.state)) === 'thinking') sawThinking = true;
  }
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ panel: document.querySelector('.gem')?.dataset.state, brain: window.__viper.brain.state }));
  check(listened === 'listening' && !sawThinking && after.panel === 'idle' && after.brain === 'listening',
    'the wake phrase alone listens, then returns to Ready quietly', `${listened} -> ${after.panel} (session ${after.brain})`);
  if (dry) {
    await page.evaluate((heard) => {
      window.__reply = () => {
        const brain = window.__viper.brain;
        brain.handleMessage({ serverContent: { inputTranscription: { text: heard } } });
        brain.handleMessage({ serverContent: { outputTranscription: { text: 'Five, eight millimetres apart.' } } });
        brain.handleMessage({ serverContent: { turnComplete: true } });
      };
    }, `Hey Gemini, ${question}?`);
  }

  await feed(['so this panel is gemini', 'hey gemini', 'hey gemini'], false);
  check(await talking(), 'the wake phrase opens a question');

  const chunkBytes = 16000 * 2 * 0.1;
  const started = Date.now();
  const words = question.split(' ');
  for (let off = 0, n = 0; off < pcm.length; off += chunkBytes, n++) {
    await page.evaluate((data) => window.__viper.brain.injectSpeech(data), pcm.subarray(off, Math.min(pcm.length, off + chunkBytes)).toString('base64'));
    if (n % 4 === 3) {
      const said = words.slice(0, Math.max(1, Math.round((off / pcm.length) * words.length))).join(' ');
      await feed(['so this panel is gemini', 'hey gemini', `hey gemini ${said}`], false);
    }
    const due = started + (n + 1) * 100;
    if (due > Date.now()) await page.waitForTimeout(due - Date.now());
  }
  const live = await page.evaluate(() => document.querySelector('.gem__q')?.textContent || '');
  check(live.length > 4 && !/gemini/i.test(live), 'the question shows as it is spoken, without the wake phrase', live);
  await feed(['so this panel is gemini', 'hey gemini', `hey gemini ${question}`], true);
  await page.waitForTimeout(900);
  check(!(await talking()), 'a pause ends the question');
  await page.evaluate(() => window.__viper.brain.injectSpeech(''));

  const until = Date.now() + 25000;
  let log = null;
  while (Date.now() < until) {
    await page.waitForTimeout(400);
    log = await page.evaluate(() => ({ ...window.__askLog }));
    if (log.turns > 0) break;
  }
  await page.waitForTimeout(1500);
  const answer = await page.evaluate(() => document.querySelector('.gem__a')?.textContent || '');
  check(answer.trim().length > 0, 'answer', answer.trim().slice(0, 140) || 'no answer on the panel');
}

// ---- Gemini moves between steps but never places or skips a suture. (Stand-in only: a made-up tool call
// cannot be answered to the real session.)
if (dry) {
  console.log('\nSutures cannot be skipped');
  const tool = (name, args = {}) => page.evaluate(({ name, args }) => {
    window.__viper.brain.handleMessage({ toolCall: { functionCalls: [{ id: 'skip', name, args }] } });
    const p = window.__viper.scene.procedure;
    return { step: p.step.id, done: p.stitchesDone };
  }, { name, args });
  await page.evaluate(() => window.__viper.scene.procedure.goToId('stitch'));
  let now = await tool('next_step');
  check(now.step === 'stitch' && now.done === 0, 'next_step with sutures still to place is refused', `${now.step}, ${now.done} placed`);
  now = await tool('go_to_step', { step: 'complete' });
  check(now.step === 'stitch' && now.done === 0, 'go_to_step complete with sutures still to place is refused', `${now.step}, ${now.done} placed`);
  now = await tool('previous_step');
  check(now.step === 'plan', 'going back still works', now.step);
}

info = await state();
console.log(`\nEnded at compatibility level ${info.level}, state "${info.state}".`);
const problems = [...new Set(consoleLines)].filter((l) => /warn|error/i.test(l)).slice(-10);
if (problems.length) console.log('Console (attending):\n' + problems.join('\n'));
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
