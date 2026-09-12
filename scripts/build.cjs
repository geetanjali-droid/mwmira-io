const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const file of ['index.html','css/styles.css','js/firebase-init.js','js/auth-client.js','js/api-bridge.js','js/clientscript.js']){
 const destination=path.join(root,'dist',file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,file),destination);
}
console.log('Built dashboard assets. Server code and legacy adapters are excluded from public files.');
