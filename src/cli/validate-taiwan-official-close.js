import { validateTaiwanOfficialClose } from '../official/taiwan-close-validator.js';

const requestedDate = process.argv.find((argument) => argument.startsWith('--date='))?.slice(7) || '';
const result = await validateTaiwanOfficialClose({ root: process.cwd(), date: requestedDate });
console.log(JSON.stringify({ status: result.status, date: result.date || null, officialDates: result.officialDates || [] }));
if (!['verified', 'already_verified'].includes(result.status)) process.exitCode = 1;
