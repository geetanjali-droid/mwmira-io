(function(){
  window.google=window.google||{};google.script=google.script||{};let queue=Promise.resolve();
  function runner(success,failure){return new Proxy({}, {get(target,name){
    if(name==='withSuccessHandler')return fn=>runner(fn,failure);
    if(name==='withFailureHandler')return fn=>runner(success,fn);
    return (...args)=>{queue=queue.then(async()=>{try{const result=name==='checkLoginPasscode'?await MiraAuth.signIn(...args):await MiraAuth.rpc(name,args);success?.(result);}catch(error){failure?.(error);}}).catch(error=>console.error(error));};
  }});}
  google.script.run=runner();
})();
