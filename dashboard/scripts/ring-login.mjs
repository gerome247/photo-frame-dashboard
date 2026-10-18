// One-time Ring login for the doorbell tab. Run it yourself in a terminal:
//
//   cd dashboard && node scripts/ring-login.mjs
//
// Asks for the Ring email and password (the password is not echoed), then a code from the
// authenticator app or from Ring. Stores only a refresh token in .ring-token (mode 600).
// The password is not saved. Nothing from the account is printed.
import { createInterface } from 'node:readline';
import { newHardwareId, passwordGrant, writeToken } from './ring-bridge.mjs';

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run this in your own terminal: cd dashboard && node scripts/ring-login.mjs');
  process.exit(1);
}

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const email = await ask('Ring email: ');
const password = await ask('Ring password (hidden): ', true);
if (!email || !password || email.length > 200) {
  console.error('Email and password are both required.');
  process.exit(1);
}

const hardwareId = newHardwareId();
let code = '';
let prompts = 0;
while (prompts < 3) {
  let result;
  try {
    result = await passwordGrant({ email, password, hardwareId, code });
  } catch {
    console.error('Ring didn\u2019t answer. Try again in a minute.');
    process.exit(1);
  }
  if (result.ok) {
    writeToken(hardwareId, result.refreshToken);
    console.log('Ring connected. Reload the dashboard in a minute.');
    process.exit(0);
  }
  if (result.busy) {
    console.error('Ring is sending too many codes. Wait 10 minutes and run this again.');
    process.exit(1);
  }
  if (result.refused) {
    console.error('Ring refused the login.');
    process.exit(1);
  }
  if (result.badCode) console.error('That code was not accepted.');
  prompts++;
  if (prompts >= 3) break;
  code = await ask(result.need === 'totp' ? 'Code from authenticator app: ' : 'Code from Ring: ');
  if (!code) {
    console.error('A code is required.');
    process.exit(1);
  }
}
console.error('Ring refused the login.');
process.exit(1);
