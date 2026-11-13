/** Cached credentials are not proof of identity. Network errors must not erase them. */
export function createIdentitySession({storage,key,fetchUser,onChange=()=>{},now=Date.now}){
  let current={token:'',user:null,status:'anonymous',error:null},revision=0,pending=null,checkedAt=0;
  const saved=()=>{try{const value=JSON.parse(storage.getItem(key)||'null');return /^[\w-]{43}$/.test(value?.token||'')&&value.expiresAt>now()?value:null;}catch{return null;}};
  const update=next=>{const previous=current;current={...current,...next};onChange(current,previous);};
  function forget(requestToken){
    if(requestToken&&requestToken!==current.token)return;
    if(requestToken&&saved()?.token&&saved().token!==requestToken)return;
    revision++;pending=null;storage.removeItem(key);update({token:'',user:null,status:'anonymous',error:null});
  }
  function accept(result){
    revision++;pending=null;storage.setItem(key,JSON.stringify(result));checkedAt=now();
    update({token:result.token,user:result.user,status:'ready',error:null});
  }
  function refresh({force=false}={}){
    const credential=saved();
    if(!credential){if(current.token||current.user||current.status!=='anonymous')forget();return Promise.resolve(null);}
    if(pending?.token===credential.token)return pending.promise;
    if(!force&&credential.token===current.token&&current.status==='ready'&&now()-checkedAt<30000)return Promise.resolve(current.user);
    const generation=++revision,token=credential.token;
    update({token,user:token===current.token?current.user:null,status:'checking',error:null});
    const stillCurrent=()=>generation===revision&&saved()?.token===token;
    const promise=Promise.resolve().then(()=>fetchUser(token)).then(user=>{
      if(!stillCurrent())return null;
      if(!user){forget(token);return null;}
      checkedAt=now();update({user,status:'ready',error:null});return user;
    }).catch(error=>{
      if(!stillCurrent())return null;
      if(error.status===401){forget(token);return null;}
      update({status:'unavailable',error});return null;
    }).finally(()=>{if(pending?.generation===generation)pending=null;});
    pending={token,promise,generation};return promise;
  }
  return {refresh,accept,forget,get snapshot(){return current;},get hasCredential(){return !!saved();}};
}
