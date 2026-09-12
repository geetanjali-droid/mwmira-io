(function () {
  let controller, refreshTimer, reconnectTimer, initial=true, signingIn=false, generation=0;
  const status=text=>{ for(const id of ['firebase-status','connection-status']){const el=document.getElementById(id);if(el)el.textContent=text;} };
  const errors={'auth/invalid-credential':'Incorrect email or password.','auth/operation-not-allowed':'This sign-in provider is not enabled in Firebase yet.','auth/unauthorized-domain':'This website must be added to Firebase Authentication authorized domains.','auth/popup-closed-by-user':'Sign-in was cancelled.'};
  function stop(){generation++;controller?.abort();clearTimeout(refreshTimer);clearTimeout(reconnectTimer);}
  function clear(){
    stop();window.CURRENT_EMAIL=null;
    if(typeof DASHBOARD_DATA!=='undefined')DASHBOARD_DATA=null;
    if(typeof FULL_DATA!=='undefined')FULL_DATA={raw:[],pack:[],fg:[],sup:[],batches:[],adminCosting:[],priceHistory:[],users:[]};
    document.getElementById('app-wrapper').style.display='none';document.getElementById('login-overlay').style.display='flex';document.getElementById('login-passcode').value='';
    const button=document.querySelector('.btn-login-gold');button.disabled=false;button.textContent='Sign In';
    document.querySelectorAll('.modal-overlay.open').forEach(el=>el.classList.remove('open'));document.body.classList.remove('modal-active');status('Sign in to access inventory.');
  }
  async function rpc(method,args=[]){
    const user=AUTH.currentUser;if(!user)throw new Error('Please sign in.');const started=generation;
    const response=await fetch('/api/inventory',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},body:JSON.stringify({method,args})});
    const payload=await response.json();
    if(started!==generation||AUTH.currentUser?.uid!==user.uid)throw new Error('Your session changed. Sign in again.');
    if(!response.ok){if(response.status===401||(response.status===403&&['getDashboardData','getAnalytics'].includes(method))){await AUTH.signOut();clear();}throw new Error(payload.error||'Request failed.');}
    return payload.result;
  }
  async function stream(){
    clearTimeout(reconnectTimer);controller?.abort();const user=AUTH.currentUser;if(!user)return;
    const current=new AbortController();controller=current;
    try{
      const response=await fetch('/api/events',{headers:{Authorization:'Bearer '+await user.getIdToken()},signal:current.signal});
      if(!response.ok)throw new Error('Live updates unavailable');status('Live updates connected');
      const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
      while(true){const chunk=await reader.read();if(chunk.done)break;pending+=decoder.decode(chunk.value,{stream:true});let split;
        while((split=pending.indexOf('\n\n'))!==-1){const event=pending.slice(0,split);pending=pending.slice(split+2);if(event.includes('event: changed')){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(AUTH.currentUser)loadDashboard();},120);}}
      }
    }catch(error){if(!current.signal.aborted)status('Live connection interrupted · retrying');}
    finally{if(!current.signal.aborted&&AUTH.currentUser?.uid===user.uid)reconnectTimer=setTimeout(stream,1500);}
  }
  async function authorize(){const dashboard=await rpc('getDashboardData');window.CURRENT_EMAIL=dashboard.userEmail;stream();return {dashboard};}
  async function signIn(email,password){
    signingIn=true;try{await AUTH.setPersistence(firebase.auth.Auth.Persistence.SESSION);await AUTH.signInWithEmailAndPassword(email,password);return await authorize();}
    catch(error){await AUTH.signOut();throw new Error(errors[error.code]||error.message);}finally{signingIn=false;}
  }
  async function googleSignIn(){
    if(signingIn)return;signingIn=true;const button=document.getElementById('google-login');button.disabled=true;
    try{await AUTH.setPersistence(firebase.auth.Auth.Persistence.SESSION);await AUTH.signInWithPopup(new firebase.auth.GoogleAuthProvider());const result=await authorize();show(result);}
    catch(error){await AUTH.signOut();document.getElementById('login-error').textContent=errors[error.code]||error.message;}finally{signingIn=false;button.disabled=false;}
  }
  function show(result){document.getElementById('login-overlay').style.display='none';document.getElementById('app-wrapper').style.display='block';applyDashboard(result.dashboard);}
  document.addEventListener('DOMContentLoaded',()=>AUTH.onAuthStateChanged(async user=>{
    if(!user){clear();initial=false;return;}
    if(initial&&!signingIn){initial=false;try{show(await authorize());}catch(error){await AUTH.signOut();document.getElementById('login-error').textContent=error.message;}}
  }));
  window.MiraAuth={rpc,signIn,googleSignIn,signOut:async()=>{stop();await AUTH.signOut();clear();},stop};
  window.addEventListener('pagehide',stop);window.addEventListener('pageshow',event=>{if(event.persisted&&AUTH.currentUser)stream();});
})();
