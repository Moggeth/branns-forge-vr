import {createHash} from 'node:crypto';
// Git's Windows CRLF conversion does not change JavaScript's evaluated text.
// Binary payload hashes remain byte-exact; only source fingerprints normalize EOL.
export const fingerprintSource=bytes=>createHash('sha256').update(Buffer.from(bytes).toString('utf8').replace(/\r\n?/g,'\n')).digest('hex');
