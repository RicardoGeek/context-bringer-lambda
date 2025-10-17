// run-local.mjs
import { handler } from './handler.mjs';

const arg = process.argv.find(a => a.startsWith('--handle='));
const handle = (arg ? arg.split('=')[1] : 'Twitter').replace(/^@/, '');

(async () => {
  try {
    const result = await handler({
      queryStringParameters: { handle }
    });
    
    // Pretty print
    console.log('Status:', result.statusCode);
    try {
      console.log(JSON.stringify(JSON.parse(result.body), null, 2));
    } catch {
      console.log(result.body);
    }
  } catch (e) {
    console.error('Error running handler:', e);
    process.exit(1);
  }
})();
