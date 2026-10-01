// Keep drafts per document, so opening another score does not lose a composition.
let connection;
const savedInMemory=new Map();
function database(){
  return connection??=new Promise((resolve,reject)=>{
    const request=indexedDB.open('tablens-drafts',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('scores',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function storeDraft(score){
  const snapshot=structuredClone(score),db=await database();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('scores','readwrite');transaction.objectStore('scores').put(snapshot);
    transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
  });
}
export async function listDrafts(){
  const db=await database();return new Promise((resolve,reject)=>{
    const request=db.transaction('scores').objectStore('scores').getAll();
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function updateDraftRecord(identifier,record){
  const db=await database();return new Promise((resolve,reject)=>{
    const transaction=db.transaction('scores','readwrite'),scores=transaction.objectStore('scores'),request=scores.get(identifier);
    request.onsuccess=()=>{if(request.result){request.result.libraryRecord=structuredClone(record);scores.put(request.result);}};
    transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
  });
}
export async function removeDraft(identifier){
  const db=await database();return new Promise((resolve,reject)=>{
    const transaction=db.transaction('scores','readwrite');
    transaction.objectStore('scores').delete(identifier);
    transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
  });
}
export function forgetSaved(identifier){
  savedInMemory.delete(identifier);
  try{localStorage.removeItem('tablens.saved.'+identifier);}catch{}
}
export function draftKey(score){
  const value=structuredClone(score);delete value.libraryRecord;delete value.modifiedAt;
  for(const source of value.sources??[])if(source.dataUrl)delete source.url;
  const text=JSON.stringify(value);let hash=2166136261,second=5381;
  for(let i=0;i<text.length;i++){hash=Math.imul(hash^text.charCodeAt(i),16777619);second=Math.imul(second,33)^text.charCodeAt(i);}
  return `${text.length}:${hash>>>0}:${second>>>0}`;
}
export function rememberSaved(score){
  const saved={revision:score.libraryRecord?.revision,key:draftKey(score)};savedInMemory.set(score.id,saved);
  try{localStorage.setItem('tablens.saved.'+score.id,JSON.stringify(saved));}catch{}
}
export function isSaved(score){
  if(!score.libraryRecord)return false;
  try{const saved=savedInMemory.get(score.id)??JSON.parse(localStorage.getItem('tablens.saved.'+score.id));return saved?.revision===score.libraryRecord.revision&&saved.key===draftKey(score);}
  catch{return false;}
}
