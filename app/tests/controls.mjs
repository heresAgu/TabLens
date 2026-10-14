// Follow the editor's navigation before interacting with moved controls.
export function control(page,selector){
  const locator=page.locator(selector);
  return new Proxy(locator,{get(target,name){
    const method=target[name];if(typeof method!=='function')return method;
    if(!['click','fill','selectOption','check','uncheck','press'].includes(name))return method.bind(target);
    return async(...args)=>{
      const location=await target.evaluate(element=>({tab:element.closest('[data-editor-page]')?.dataset.editorPage,effect:element.closest('[data-effect-section]')?.dataset.effectSection,practice:!!element.closest('#practice-dialog'),dialog:element.closest('dialog')?.id}));
      if(await page.locator('#practice-dialog').evaluate(element=>element.open)&&!location.practice)await page.locator('#practice-close').click();
      if(location.practice&&!await page.locator('#practice-dialog').evaluate(element=>element.open))await page.locator('#practice-settings').click();
      if(location.dialog==='library-dialog'&&!await page.locator('#library-dialog').evaluate(element=>element.open))await page.locator('#open-library').click();
      if(location.tab)await page.locator(`[data-editor-tab="${location.tab}"]`).click();
      if(location.effect&&!await page.locator(`[data-effect-section="${location.effect}"]`).evaluate(element=>element.open))
        await page.locator(`[data-editor-effect="${location.effect}"]`).click();
      return method.apply(target,args);
    };
  }});
}
