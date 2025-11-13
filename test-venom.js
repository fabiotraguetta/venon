const venom = require('venom-bot');

venom.create({
  session: 'teste-simples',
  multidevice: true,
  headless: false,
})
.then((client) =>  {
  console.log('CLIENTE PRONTO');
  start(client);
  // client.onStateChange((s) => console.log('[STATE]', s));
  // client.onAnyMessage((m) => console.log('[ANY]', m.type, m.from, (m.body || '').slice(0, 80)));
  // client.onMessage((m) => console.log('[MSG]', m.type, m.from, (m.body || '').slice(0, 80)));
})
.catch((e) => console.error(e));


function start(client) {
  client.onMessage((message) => {
    if (message.body === 'Hi' && message.isGroupMsg === false) {
      client
        .sendText(message.from, 'Welcome Venom 🕷')
        .then((result) => {
          console.log('Result: ', result); //return object success
        })
        .catch((erro) => {
          console.error('Error when sending: ', erro); //return object error
        });
    }
  });
}