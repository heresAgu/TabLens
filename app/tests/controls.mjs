// Follow the editor's navigation before interacting with moved controls.
export function control(page,selector){
  const locator=page.locator(selector);
  return new Proxy(locator,{get(target,name){
    const method=target[name];if(typeof method!=='function')return method;
    if(!['click','fill','selectOption','check','uncheck','press'].includes(name))return method.bind(target);
    return async(...args)=>{
      const location=await target.evaluate(element=>({tab:element.closest('[data-editor-page]')?.dataset.editorPage,practice:!!element.closest('#practice-dialog'),dialog:element.closest('dialog')?.id}));
      if(await page.locator('#practice-dialog').evaluate(element=>element.open)&&!location.practice)await page.locator('#practice-close').click();
      if(location.practice&&!await page.locator('#practice-dialog').evaluate(element=>element.open))await page.locator('#practice-settings').click();
      if(location.tab)await page.locator(`[data-editor-tab="${location.tab}"]`).click();
      return method.apply(target,args);
    };
  }});
}
