import {test,expect} from './authenticated'

const existingProject={id:'project-style-fixture',title:'Existing styled project',category:'personal',description:'Keep these instructions.',deadline:'2026-10-20',importance:2,remainingMinutes:90,progress:'In progress',status:'active'}

async function expectStyledProjectControls(page:import('@playwright/test').Page){
 const save=page.getByRole('button',{name:'Save project',exact:true})
 const cancel=page.getByRole('button',{name:'Cancel',exact:true})
 const file=page.getByLabel('Attach instructions')
 const styles=await page.evaluate(({saveSelector,cancelSelector,fileSelector})=>{
  const save=getComputedStyle(document.querySelector(saveSelector)!)
  const cancel=getComputedStyle(document.querySelector(cancelSelector)!)
  const picker=getComputedStyle(document.querySelector(fileSelector)!,'::file-selector-button')
  return {
   save:{background:save.backgroundColor,border:save.borderStyle,radius:save.borderRadius},
   cancel:{background:cancel.backgroundColor,border:cancel.borderStyle,radius:cancel.borderRadius},
   picker:{background:picker.backgroundColor,border:picker.borderStyle,radius:picker.borderRadius,padding:picker.padding},
  }
 },{saveSelector:'.project-form-save',cancelSelector:'.project-form-cancel',fileSelector:'.project-file-input'})
 expect(styles.save).toMatchObject({background:'rgb(156, 141, 232)',border:'solid',radius:'7px'})
 expect(styles.cancel).toMatchObject({background:'rgb(32, 33, 56)',border:'solid',radius:'7px'})
 expect(styles.picker.background).not.toBe('rgb(239, 239, 239)')
 expect(styles.picker).toMatchObject({border:'solid',radius:'6px',padding:'8px 12px'})

 await file.focus()
 await page.keyboard.press('Tab')
 await expect(save).toBeFocused()
 expect(await save.evaluate(element=>getComputedStyle(element).outlineStyle)).toBe('solid')
 await page.keyboard.press('Tab')
 await expect(cancel).toBeFocused()
 expect(await cancel.evaluate(element=>getComputedStyle(element).outlineStyle)).toBe('solid')
}

test('new and edit project forms use scoped controls and retain native file upload',async({page})=>{
 let uploadedName='',uploadedContent=''
 await page.route('**/api/v1/planner/material',route=>{
  const body=route.request().postDataJSON() as {name:string;content:string}
  uploadedName=body.name
  uploadedContent=Buffer.from(body.content,'base64').toString()
  return route.fulfill({json:{name:uploadedName,text:'Synthetic fixture text'}})
 })
 await page.route('**/api/v1/planner/snapshot',route=>route.fulfill({json:{projects:[{data:existingProject,version:1}],actions:[],status:{}}}))
 await page.setViewportSize({width:1280,height:900})
 await page.goto('/projects')

 await page.getByRole('button',{name:'New project',exact:true}).click()
 await expectStyledProjectControls(page)
 await page.getByLabel('Attach instructions').setInputFiles({name:'project-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic project instructions')})
 await expect(page.getByText('project-fixture.txt',{exact:true})).toBeVisible()
 expect(uploadedName).toBe('project-fixture.txt')
 expect(uploadedContent).toBe('Synthetic project instructions')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.locator('.projects-view > .project-editor').screenshot({path:'test-results/project-editor-new-desktop.png'})
 await page.getByRole('button',{name:'Cancel',exact:true}).click()

 await page.setViewportSize({width:375,height:900})
 await page.getByRole('button',{name:'Edit Existing styled project'}).click()
 await expect(page.getByRole('heading',{name:'Edit project'})).toBeVisible()
 await expectStyledProjectControls(page)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.locator('.projects-view > .project-editor').screenshot({path:'test-results/project-editor-edit-375.png'})
})
