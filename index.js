require('dotenv').config();
const crypto = require('crypto')
const express = require('express')
const bodyParser = require('body-parser')
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const secret = process.env.GITHUB_SECRET;
const sigHeaderName = 'X-Hub-Signature-256'
const sigHashAlg = 'sha256'

const app = express();

const projectConfig = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'config.json')
  )
);

// Saves a valid raw JSON body to req.rawBody
// Credits to https://stackoverflow.com/a/35651853/90674
app.use(bodyParser.json({
  verify: (req, res, buf, encoding) => {
    if (buf && buf.length) {
      req.rawBody = buf.toString(encoding || 'utf8');
    }
  },
}))

function verifyPostData(req, res, next) {
  if (!req.rawBody) {
    return next('Request body empty')
  }

  const sig = Buffer.from(req.get(sigHeaderName) || '', 'utf8')
  const hmac = crypto.createHmac(sigHashAlg, secret)
  const digest = Buffer.from(sigHashAlg + '=' + hmac.update(req.rawBody).digest('hex'), 'utf8')
  if (sig.length !== digest.length || !crypto.timingSafeEqual(digest, sig)) {
    return next(`Request body digest (${digest}) did not match ${sigHeaderName} (${sig})`)
  }

  return next()
}

app.post('/', verifyPostData, async function (req, res) {
  const {repository: { name = '' } = {}, ref} = req.body || {};
  const [, branch] = /^refs\/heads\/(.*)$/g.exec(ref);

  if (!projectConfig[name]) {
    console.log(`Skip unknown project: "${name}"`);
  } else if (!projectConfig[name][branch]) {
    console.log(`Skip unknown branch: "${branch}"`);
  } else {
    const config = projectConfig[name][branch];
    update(name, branch, config);
  }

  res.status(200).send('Request body was signed');
})

app.use((err, req, res, next) => {
  if (err) console.error(err)
  res.status(403).send('Request body was not signed or verification failed')
})

app.listen(3000, () => console.log("Listening on port 3000"));

async function update(appName, branch, config) {
  console.log(`Update:`);
  console.log(`repo: ${appName}`);
  console.log(`branch: ${branch}`);

  process.chdir(path.join(__dirname, '..', config.path));
  await runProcess('pm2', ['stop', config.pm2]);
  await runProcess('git', ['reset', '--hard']);
  await runProcess('git', ['fetch']);
  await runProcess('git', ['checkout', `origin/${branch}`]);
  await runProcess('npm', ['i']);
  await runProcess('pm2', ['start', config.pm2]);
}

function runProcess(process, args) {
  return new Promise(resolve => {
    const command = spawn(process, args);
    command.stdout.on("data", data => {
      console.log(`stdout: ${data}`);
    });
    command.stderr.on("data", data => {
      console.log(`stderr: ${data}`);
    });
    command.on('error', (error) => {
      console.log(`error: ${error.message}`);
    });
    command.on("close", code => {
      console.log(`child process "${process}" exited with code ${code}`);
      resolve();
    });
  });
}

