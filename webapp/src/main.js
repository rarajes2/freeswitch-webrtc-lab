// Minimal SIP.js SimpleUser-based softphone for the FreeSWITCH WebRTC lab.
// See docs/INTAKE.md §5 and docs/USER_MANUAL.md.
import { SimpleUser } from 'sip.js/lib/platform/web/index.js'

const $ = (id) => document.getElementById(id)
const log = (msg) => {
  const el = $('log')
  const line = `${new Date().toLocaleTimeString()}  ${msg}`
  el.textContent += line + '\n'
  el.scrollTop = el.scrollHeight
  console.log(line)
}

const regStatusEl = $('regStatus')
const callStatusEl = $('callStatus')
const setRegStatus = (state) => {
  regStatusEl.textContent = state
  regStatusEl.className = `status status-${state}`
}
const setCallStatus = (state) => {
  callStatusEl.textContent = state
  callStatusEl.className = `status status-${state}`
}

let simpleUser = null

function buildIceServers() {
  // coturn from docker-compose.yml -- see docs/INTAKE.md §2/§7. Static
  // long-term credentials are fine at lab scale; swap for TURN REST API
  // (time-limited credentials) once past initial bring-up.
  return [
    { urls: 'stun:localhost:3478' },
    {
      urls: ['turn:localhost:3478?transport=udp', 'turn:localhost:3478?transport=tcp'],
      username: 'labuser',
      credential: 'changeme_turn',
    },
  ]
}

async function register() {
  const wsUrl = $('wsUrl').value.trim()
  const extension = $('extension').value.trim()
  const password = $('password').value
  const domain = $('domain').value.trim()
  const aor = `sip:${extension}@${domain}`

  simpleUser = new SimpleUser(wsUrl, {
    aor,
    media: {
      remote: { audio: $('remoteAudio') },
    },
    userAgentOptions: {
      authorizationUsername: extension,
      authorizationPassword: password,
      sessionDescriptionHandlerFactoryOptions: {
        peerConnectionConfiguration: {
          iceServers: buildIceServers(),
        },
      },
    },
    delegate: {
      onServerConnect: () => log('WebSocket connected'),
      onServerDisconnect: (error) => {
        // Surfaces *why* the socket closed -- a bad/untrusted TLS cert
        // (see docs/DEBUGGING.md "websocket is closing the connection")
        // closes silently with no other feedback otherwise.
        log(`WebSocket disconnected${error ? `: ${error.message || error}` : ''}`)
        setRegStatus('unregistered')
      },
      onRegistered: () => {
        setRegStatus('registered')
        log(`Registered as ${aor}`)
        $('callBtn').disabled = false
      },
      onUnregistered: () => {
        setRegStatus('unregistered')
        log('Unregistered')
        $('callBtn').disabled = true
      },
      onCallReceived: async () => {
        log('Incoming call')
        setCallStatus('ringing')
        $('incoming').hidden = false
        $('incomingFrom').textContent = extension
      },
      onCallAnswered: () => {
        setCallStatus('active')
        $('incoming').hidden = true
        $('hangupBtn').disabled = false
        $('muteBtn').disabled = false
        $('holdBtn').disabled = false
        log('Call answered')
      },
      onCallHangup: () => {
        setCallStatus('idle')
        $('incoming').hidden = true
        $('hangupBtn').disabled = true
        $('muteBtn').disabled = true
        $('holdBtn').disabled = true
        log('Call ended')
      },
      onCallCreated: () => log('Call created'),
    },
  })

  try {
    await simpleUser.connect()
    await simpleUser.register()
  } catch (err) {
    log(`Registration failed: ${err.message || err}`)
    setRegStatus('unregistered')
  }

  $('registerBtn').disabled = true
  $('unregisterBtn').disabled = false
}

async function unregister() {
  if (!simpleUser) return
  try {
    await simpleUser.unregister()
    await simpleUser.disconnect()
  } catch (err) {
    log(`Unregister error: ${err.message || err}`)
  }
  $('registerBtn').disabled = false
  $('unregisterBtn').disabled = true
  $('callBtn').disabled = true
}

async function call() {
  if (!simpleUser) return
  const destination = $('destination').value.trim()
  const domain = $('domain').value.trim()
  const target = `sip:${destination}@${domain}`
  log(`Calling ${target}...`)
  setCallStatus('dialing')
  try {
    await simpleUser.call(target)
  } catch (err) {
    log(`Call failed: ${err.message || err}`)
    setCallStatus('idle')
  }
}

async function hangup() {
  if (!simpleUser) return
  try {
    await simpleUser.hangup()
  } catch (err) {
    log(`Hangup error: ${err.message || err}`)
  }
}

let muted = false
async function toggleMute() {
  if (!simpleUser) return
  muted = !muted
  if (muted) {
    simpleUser.mute()
    $('muteBtn').textContent = 'Unmute'
  } else {
    simpleUser.unmute()
    $('muteBtn').textContent = 'Mute'
  }
}

let held = false
async function toggleHold() {
  if (!simpleUser) return
  held = !held
  try {
    if (held) {
      await simpleUser.hold()
      $('holdBtn').textContent = 'Unhold'
      setCallStatus('held')
    } else {
      await simpleUser.unhold()
      $('holdBtn').textContent = 'Hold'
      setCallStatus('active')
    }
  } catch (err) {
    log(`Hold error: ${err.message || err}`)
  }
}

async function answer() {
  if (!simpleUser) return
  try {
    await simpleUser.answer()
  } catch (err) {
    log(`Answer failed: ${err.message || err}`)
  }
}

async function decline() {
  if (!simpleUser) return
  try {
    await simpleUser.decline()
  } catch (err) {
    log(`Decline error: ${err.message || err}`)
  }
  $('incoming').hidden = true
  setCallStatus('idle')
}

$('registerBtn').addEventListener('click', register)
$('unregisterBtn').addEventListener('click', unregister)
$('callBtn').addEventListener('click', call)
$('hangupBtn').addEventListener('click', hangup)
$('muteBtn').addEventListener('click', toggleMute)
$('holdBtn').addEventListener('click', toggleHold)
$('answerBtn').addEventListener('click', answer)
$('declineBtn').addEventListener('click', decline)

log('Ready. Fill in the extension/password from your .env and click Register.')
