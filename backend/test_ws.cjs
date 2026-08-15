
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:43111/api/ws/sync?userId=test&deviceId=test');

ws.on('open', () => {
  console.log('Connected');
  
  const payload = {
    type: 'tutor.generate_tutorial',
    data: {
      exerciseId: 'Hammer Curl',
      exerciseName: 'Hammer Curl',
      type: 'resistance'
    }
  };
  
  console.log('Sending:', payload);
  ws.send(JSON.stringify(payload));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  console.log('Received:', msg.type);
  if (msg.type === 'tutor.tutorial_result') {
    console.log('Content Length:', msg.data.content_md?.length);
    console.log('Source:', msg.data.source);
    console.log('Is Final:', msg.data.isFinal);
    console.log('Preview:', msg.data.content_md?.substring(0, 100));
    ws.close();
  }
});

ws.on('error', (err) => {
  console.error('Error:', err);
});
