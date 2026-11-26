// پوشهٔ برنامه (دو سطح بالاتر از این فایل) را در www کپی می‌کند
const path = require('path');
const copyApp = require('../copy-app');
copyApp(path.resolve(__dirname, '..', '..'), path.join(__dirname, 'www'), path.join(__dirname, 'node_modules'));
console.log('www آماده شد');
