// Pont entre l'interface StockInfos et Android (remplace celui de l'appli PC)
(function(){
  var B=window.AndroidBridge,wait={},n=0;
  window.__abReply=function(id,ok,payload){var w=wait[id];if(!w)return;delete wait[id];if(ok){try{w.res(JSON.parse(payload))}catch(e){w.res(payload)}}else w.rej(new Error(payload))};
  function call(name,arg){return new Promise(function(res,rej){var id='c'+(++n);wait[id]={res:res,rej:rej};B.call(id,name,arg==null?'':String(arg))})}
  var no=function(){return Promise.resolve(false)};
  window.api={
    platform:'android',version:B.version(),
    load:function(){var t=B.load();if(!t)return null;try{return JSON.parse(t)}catch(e){return null}},
    save:function(d){return B.save(JSON.stringify(d))?true:'enregistrement impossible'},
    backupNow:function(){return B.backup()},
    fetchICS:function(){return Promise.resolve('')},
    theme:function(){},updateState:function(){return{state:'idle'}},onUpdate:function(){},updateCheck:no,updateInstall:no,
    exportData:no,importData:no,openDataFolder:no,saveFile:no,
    savePdf:function(o){B.printPage((o&&o.name)||'StockInfos');return Promise.resolve(false)},print:function(){B.printPage('StockInfos');return Promise.resolve(false)},
    gStatus:function(){return Promise.resolve({configured:false,connected:false})},gLogin:no,gLogout:no,gApi:function(){return Promise.reject(new Error('Google Agenda : sur le PC'))},
    dbStatus:function(){return Promise.resolve(JSON.parse(B.dbStatus()))},
    dbConnect:function(c){return call('dbConnect',c)},
    dbDisconnect:function(){B.dbDisconnect();return Promise.resolve(true)},
    dbReq:function(o){return call('dbReq',JSON.stringify(o))}
  };
})();
