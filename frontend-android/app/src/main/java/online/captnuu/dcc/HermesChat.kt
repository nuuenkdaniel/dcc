package online.captnuu.dcc

import android.os.Build
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import androidx.compose.ui.input.key.*
import org.json.JSONObject

internal val HermesChatImeBottom=SemanticsPropertyKey<Int>("HermesChatImeBottom")
internal val HermesChatMenuState=SemanticsPropertyKey<String>("HermesChatMenuState")
// Workspace provides this around both production and fixture hosts. Claim IME
// ownership in the opening event, before the Dialog can show its keyboard.
internal val LocalHermesModalVisibility=staticCompositionLocalOf<(Boolean)->Unit>{{}}

/** Modal window, not a replacement composition for the workspace. Dismissal is
 * deliberately presentation-only: no controller close, abort, edit or network. */
@OptIn(ExperimentalComposeUiApi::class,ExperimentalLayoutApi::class)
@Composable internal fun HermesChatHost(state:HermesState,onEdit:(String)->Unit,onSend:()->Unit,onNew:()->Unit,onRead:()->Unit,onClearChat:()->Unit,modifier:Modifier,onRecover:()->Unit){
    val modalVisibility=LocalHermesModalVisibility.current
    key(state.ownerKey){
        var open by rememberSaveable{mutableStateOf(false)}
        var continueChoice by remember{mutableStateOf(false)}
        // Covers restored-open composition, owner changes and host disposal in
        // addition to the synchronous input/close paths. No controller operation.
        SideEffect{modalVisibility(open)}
        DisposableEffect(modalVisibility){onDispose{modalVisibility(false)}}
        val closing=remember{mutableStateOf(false)}
        val text=if(answering(state))state.answer else state.draft
        var start by rememberSaveable{mutableStateOf(text.length)};var end by rememberSaveable{mutableStateOf(text.length)}
        var composition by remember{mutableStateOf<TextRange?>(null)}
        var compositionText by remember{mutableStateOf(text)}
        val value=TextFieldValue(text,TextRange(start.coerceIn(0,text.length),end.coerceIn(0,text.length)),composition?.takeIf{text==compositionText&&it.max<=text.length})
        val change:(TextFieldValue)->Unit={v->if(!closing.value){start=v.selection.start;end=v.selection.end;composition=v.composition;compositionText=v.text;if(v.text!=text)onEdit(v.text)}}
        val workspaceFocus=LocalFocusManager.current;val keyboard=LocalSoftwareKeyboardController.current
        val list=rememberLazyListState();var displayed by rememberSaveable{mutableStateOf("")}
        val showChat={modalVisibility(true);closing.value=false;open=true}
        val close={closing.value=true;workspaceFocus.clearFocus(force=true);keyboard?.hide();open=false;modalVisibility(false)}
        val canSend=state.storageReady&&!state.busy&&!state.receiptChecking&&text.isNotBlank()
        val send={if(canSend){showChat();if(state.available&&(needsHermesClose(state)||repeatsUnconfirmedHermesRequest(state)))continueChoice=true else onSend()}}
        // This is a typeable entrance, not a second selection owner. Focus/click
        // and blur may collapse its cursor without editing text; those callbacks
        // must not replace the chat's saved range or reopen a dismissed window.
        BasicTextField(value,{v->if(v.text!=text){showChat();change(v)}},modifier=modifier.height(48.dp).background(MaterialTheme.colorScheme.primary.copy(alpha=.08f),RoundedCornerShape(50)).border(1.dp,MaterialTheme.colorScheme.primary.copy(alpha=.25f),RoundedCornerShape(50)).testTag("hermes-editor").onFocusChanged{if(it.isFocused)showChat()}.semantics{contentDescription="Hermes"},singleLine=true,textStyle=LocalTextStyle.current.copy(fontSize=16.sp,color=MaterialTheme.colorScheme.onSurface),cursorBrush=SolidColor(MaterialTheme.colorScheme.primary),decorationBox={editor->
            Row(Modifier.fillMaxSize().padding(horizontal=14.dp),verticalAlignment=Alignment.CenterVertically){
                Box(Modifier.weight(1f)){
                    if(text.isEmpty())Text("Hermes",fontSize=16.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    editor()
                }
                if(state.busy||state.rootKey!=null||state.timeline.isNotEmpty()||state.receipt!=null)Text(if(state.busy)"…" else "•",modifier=Modifier.semantics{contentDescription=if(state.busy)"Chat request pending" else "Resume local chat"})
            }
            },keyboardOptions=KeyboardOptions(imeAction=ImeAction.Send),keyboardActions=KeyboardActions(onSend={send()}))
        LaunchedEffect(open){if(open)workspaceFocus.clearFocus(force=true)}
        if(open)Dialog(onDismissRequest={},properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false,dismissOnClickOutside=false,dismissOnBackPress=false)){
            // Menu ownership must outlive either adaptive trigger/editor node.
            var menuOpen by remember{mutableStateOf(false)}
            val imeInsets=WindowInsets.ime
            val imeBottom=imeInsets.getBottom(LocalDensity.current)
            val windowFocused=LocalWindowInfo.current.isWindowFocused
            var menuHadKeyboard by remember{mutableStateOf(false)}
            var restoreMenuKeyboard by remember{mutableStateOf(false)}
            var editorFocusAllowed by remember{mutableStateOf(true)}
            var keyboardDismissed by remember{mutableStateOf(false)}
            var keyboardHidePending by remember{mutableStateOf(false)}
            var hadEditorIme by remember{mutableStateOf(false)}
            var confirmClose by remember{mutableStateOf(false)}
            var confirmRecovery by remember{mutableStateOf(false)}
            var menuSelection by remember{mutableStateOf(value.selection)}
            var menuSelectionFenced by remember{mutableStateOf(false)}
            var editorLayoutIme by remember{mutableStateOf(-1)}
            val density=LocalDensity.current
            val imeTarget=WindowInsets.imeAnimationTarget.getBottom(density)
            var menuViewport by remember{mutableStateOf(Rect.Zero)}
            var menuAnchor by remember{mutableStateOf(Rect.Zero)}
            var editorFocused by remember{mutableStateOf(false)}
            var menuEvents by remember{mutableStateOf(listOf<String>())}
            // Bounded geometry/lifecycle evidence only; never draft/message text.
            val menuEvent:(String)->Unit={event->menuEvents=(menuEvents+event).takeLast(12)}
            val dismissMenu:(String)->Unit={reason->
                menuEvent("dismiss:$reason")
                restoreMenuKeyboard=menuHadKeyboard&&reason!="close-request"&&reason!="new"&&reason!="recover"&&!closing.value
                editorFocusAllowed=restoreMenuKeyboard
                menuOpen=false
            }
            val openMenu={
                menuHadKeyboard=imeBottom>0;menuSelection=value.selection
                menuSelectionFenced=true
                restoreMenuKeyboard=false;editorFocusAllowed=false
                menuEvent("trigger:open ime=$menuHadKeyboard");menuOpen=true
            }
            val chatFocus=LocalFocusManager.current;val chatKeyboard=LocalSoftwareKeyboardController.current
            // Fence synchronous selection-collapse callbacks before clearing focus.
            val closeDialog={closing.value=true;restoreMenuKeyboard=false;editorFocusAllowed=false;chatFocus.clearFocus(force=true);chatKeyboard?.hide();close()}
            val hideEditorKeyboard={
                if(!menuSelectionFenced)menuSelection=value.selection
                menuHadKeyboard=false;menuSelectionFenced=true
                keyboardDismissed=true;keyboardHidePending=imeBottom>0||imeTarget>0;restoreMenuKeyboard=false;editorFocusAllowed=false
                chatKeyboard?.hide()
            }
            val backDialog={when{continueChoice->continueChoice=false;confirmRecovery->confirmRecovery=false;confirmClose->confirmClose=false;menuOpen->dismissMenu("back");else->hideEditorKeyboard()}}
            val latestClose by rememberUpdatedState(backDialog)
            val dialogView=LocalView.current
            // Back dismisses transient controls or only the IME, never chat.
            // The overlay-priority
            // callback precedes the IME on gesture-back platforms; pre-IME key
            // handling below covers older Android/hardware Back.
            DisposableEffect(dialogView){
                var dispatcher:OnBackInvokedDispatcher?=null
                val callback=if(Build.VERSION.SDK_INT>=33)OnBackInvokedCallback{latestClose()} else null
                // Wait for the Dialog view to attach to its own window.
                val register=Runnable{
                    if(Build.VERSION.SDK_INT>=33&&callback!=null){
                        dispatcher=dialogView.findOnBackInvokedDispatcher()
                        dispatcher?.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_OVERLAY,callback)
                    }
                }
                dialogView.post(register)
                onDispose{
                    dialogView.removeCallbacks(register)
                    if(Build.VERSION.SDK_INT>=33&&callback!=null)dispatcher?.unregisterOnBackInvokedCallback(callback)
                }
            }
            val focus=remember{FocusRequester()}
            val entries=visibleChat(state)
            var requestedKeyboard by remember{mutableStateOf(false)}
            LaunchedEffect(continueChoice){
                if(continueChoice){menuSelection=value.selection;menuSelectionFenced=true;menuHadKeyboard=imeBottom>0;restoreMenuKeyboard=false;editorFocusAllowed=false}
            }
            LaunchedEffect(imeBottom,imeTarget,menuOpen,confirmClose,confirmRecovery,continueChoice,windowFocused){
                if(!menuOpen&&!confirmClose&&!confirmRecovery&&!continueChoice&&windowFocused){
                    if(keyboardDismissed&&imeBottom==0&&imeTarget==0)keyboardHidePending=false
                    if(keyboardDismissed&&!keyboardHidePending&&imeTarget>0){
                        // An editor tap requested IME again. Preserve the saved
                        // range through that tap/focus/layout transition.
                        keyboardDismissed=false;menuHadKeyboard=true;restoreMenuKeyboard=true;editorFocusAllowed=true
                    }else if(hadEditorIme&&imeTarget==0&&!restoreMenuKeyboard&&!keyboardDismissed){
                        menuSelection=value.selection;menuSelectionFenced=true;menuHadKeyboard=false
                        keyboardDismissed=true;keyboardHidePending=imeBottom>0;editorFocusAllowed=false
                    }
                    if(imeBottom>0)hadEditorIme=true
                }
            }
            val editorChange:(TextFieldValue)->Unit={v->
                if(v.text!=text){
                    // Genuine edits supersede the snapshot, even during focus
                    // restoration. Never replay a stale selection over new text.
                    menuSelectionFenced=false;restoreMenuKeyboard=false;menuSelection=v.selection
                    change(v)
                }else if(!continueChoice&&!confirmClose&&!confirmRecovery&&!menuOpen&&!menuSelectionFenced&&!keyboardDismissed&&!(hadEditorIme&&imeTarget==0))change(v)
            }
            LaunchedEffect(menuSelectionFenced,menuOpen,confirmClose,windowFocused,editorFocused,imeBottom,imeTarget,editorLayoutIme){
                if(menuSelectionFenced&&!keyboardDismissed&&!menuOpen&&!confirmClose&&!confirmRecovery&&!continueChoice&&!closing.value&&windowFocused&&
                    (!menuHadKeyboard||editorFocused&&imeBottom>0)&&imeBottom==imeTarget&&editorLayoutIme==imeBottom){
                    // The same editor has regained focus and has been laid out
                    // at the final IME inset, not merely requested focus/show.
                    menuEvent("selection:release ime=$imeBottom")
                    menuSelectionFenced=false
                }
            }
            Surface(Modifier.fillMaxSize().testTag("hermes-chat").semantics{
                this[HermesChatImeBottom]=imeBottom
                this[HermesChatMenuState]="open=$menuOpen editorFocused=$editorFocused keyboardDismissed=$keyboardDismissed hidePending=$keyboardHidePending restoreIme=$restoreMenuKeyboard selectionFenced=$menuSelectionFenced layoutIme=$editorLayoutIme imeTarget=$imeTarget windowFocused=$windowFocused viewport=$menuViewport anchor=$menuAnchor events=${menuEvents.joinToString(" > ")}"
            },color=MaterialTheme.colorScheme.background){
                Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars).imePadding()){
                BoxWithConstraints(Modifier.fillMaxSize().testTag("hermes-chat-content").onGloballyPositioned{menuViewport=it.boundsInWindow()}){
                val shortViewport=maxHeight<320.dp
                // The editor node survives short/normal layout transitions.
                // Never steal focus from an intentionally open menu.
                LaunchedEffect(shortViewport,menuOpen,confirmClose,confirmRecovery,continueChoice,windowFocused,restoreMenuKeyboard,keyboardDismissed){
                    menuEvent("layout:short=$shortViewport menu=$menuOpen ime=$imeBottom")
                    // Wait for the Dialog's actual window focus after popup
                    // removal; showing IME in the popup window is ineffective.
                    if(!menuOpen&&!confirmClose&&!confirmRecovery&&!continueChoice&&!keyboardDismissed&&!(hadEditorIme&&imeTarget==0&&!restoreMenuKeyboard)&&!closing.value&&windowFocused&&editorFocusAllowed){
                        if(restoreMenuKeyboard&&menuSelectionFenced){start=menuSelection.start;end=menuSelection.end}
                        focus.requestFocus()
                        if(!requestedKeyboard||restoreMenuKeyboard){chatKeyboard?.show();requestedKeyboard=true}
                        restoreMenuKeyboard=false
                    }
                }
                val signature=entries.lastOrNull()?.let{it.id+it.text+it.receipt}.orEmpty()+state.busy
                LaunchedEffect(signature){if(signature!=displayed&&entries.isNotEmpty())list.animateScrollToItem(entries.lastIndex+if(shortViewport)1 else 0);displayed=signature}
                Column(Modifier.fillMaxSize()){
                    if(!shortViewport){
                    Row(Modifier.fillMaxWidth().padding(horizontal=12.dp),verticalAlignment=Alignment.CenterVertically){
                        Text("Hermes",style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f))
                        HermesChatActionsTrigger(openMenu,{menuAnchor=it})
                        IconButton(onClick=closeDialog,modifier=Modifier.size(48.dp).testTag("hermes-chat-close").semantics{contentDescription="Close chat"}){Text("×",fontSize=28.sp)}
                    }
                    if(state.historyPruned)Text("Older settled messages were removed to keep local chat within 40 messages / 64 KiB.",Modifier.padding(horizontal=16.dp),style=MaterialTheme.typography.bodySmall)
                    }
                    LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("hermes-chat-history"),state=list,contentPadding=PaddingValues(if(shortViewport)4.dp else 12.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
                        if(shortViewport)item(key="chat-heading"){Text("Hermes",style=MaterialTheme.typography.titleLarge)}
                        if(entries.isEmpty())item{Text("Opening chat sends no message. Type a request and press Send.",style=MaterialTheme.typography.bodyMedium)}
                        items(entries,key={it.id}){entry->HermesChatBubble(entry,state)}
                        if(shortViewport){
                            if(state.historyPruned)item(key="chat-pruned"){Text("Older settled messages were removed to keep local chat within 40 messages / 64 KiB.",style=MaterialTheme.typography.bodySmall)}
                            if(state.notice.isNotBlank()&&state.notice!=state.receiptCheck.message&&entries.lastOrNull()?.text!=state.notice)item(key="chat-status"){Text(state.notice,Modifier.testTag("hermes-chat-status"),style=MaterialTheme.typography.bodySmall)}
                        }
                    }
                    if(!shortViewport){
                    if(state.notice.isNotBlank()&&state.notice!=state.receiptCheck.message&&entries.lastOrNull()?.text!=state.notice)Text(state.notice,Modifier.padding(horizontal=12.dp,vertical=4.dp).testTag("hermes-chat-status"),style=MaterialTheme.typography.bodySmall)
                    }
                    // A status lookup is acknowledged even when the receipt did
                    // not change. Keep this compact feedback above the editor,
                    // not offscreen inside an old chronological message.
                    if(state.receiptCheck!=HermesReceiptCheck.IDLE)Text(state.receiptCheck.message,Modifier.fillMaxWidth().padding(horizontal=8.dp).testTag("hermes-receipt-feedback"),style=MaterialTheme.typography.bodySmall,maxLines=if(shortViewport)1 else 2,overflow=TextOverflow.Ellipsis)
                    Row(Modifier.fillMaxWidth().padding(horizontal=if(shortViewport)4.dp else 8.dp,vertical=if(shortViewport)0.dp else 8.dp).testTag("hermes-chat-composer"),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(4.dp)){
                        val editorModifier=Modifier.weight(1f).heightIn(min=48.dp).focusRequester(focus).onGloballyPositioned{
                            editorLayoutIme=imeInsets.getBottom(density)
                        }.onFocusChanged{
                            if(editorFocused!=it.isFocused){menuEvent("editor:focus=${it.isFocused} menu=$menuOpen");editorFocused=it.isFocused}
                            if(it.isFocused&&!menuOpen&&!confirmClose&&!confirmRecovery&&!continueChoice&&!keyboardDismissed)editorFocusAllowed=true
                        }.onPreInterceptKeyBeforeSoftKeyboard{event->
                            if(event.key==Key.Back){if(event.type==KeyEventType.KeyUp)backDialog();true}else false
                        }.testTag("hermes-chat-editor")
                        // A single BasicTextField/inner editor owns selection and
                        // its input connection across IME-driven layout changes.
                        BasicTextField(value,editorChange,modifier=editorModifier.then(if(shortViewport)Modifier.height(48.dp) else Modifier).background(if(shortViewport)MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.background,MaterialTheme.shapes.small).border(1.dp,MaterialTheme.colorScheme.outline,MaterialTheme.shapes.small).semantics{contentDescription=if(answering(state))"Answer Hermes" else "Hermes"},singleLine=false,maxLines=if(shortViewport)1 else 4,textStyle=LocalTextStyle.current.copy(fontSize=16.sp,color=MaterialTheme.colorScheme.onSurface),cursorBrush=SolidColor(MaterialTheme.colorScheme.primary),keyboardOptions=KeyboardOptions(imeAction=ImeAction.Send),keyboardActions=KeyboardActions(onSend={send()}),decorationBox={editor->
                            Column(Modifier.fillMaxWidth().padding(horizontal=8.dp,vertical=if(shortViewport)0.dp else 8.dp)){
                                if(!shortViewport)Text(if(answering(state))"Answer Hermes" else "Hermes",style=MaterialTheme.typography.labelSmall)
                                Box(Modifier.fillMaxWidth().heightIn(min=if(shortViewport)48.dp else 32.dp),contentAlignment=Alignment.CenterStart){
                                    if(shortViewport&&text.isEmpty())Text(if(answering(state))"Answer Hermes" else "Hermes",fontSize=16.sp)
                                    editor()
                                }
                            }
                        })
                        Button(onClick=send,enabled=canSend,modifier=Modifier.height(48.dp).testTag("hermes-chat-send"),contentPadding=PaddingValues(horizontal=12.dp,vertical=0.dp)){Text("Send",maxLines=1)}
                        if(shortViewport)HermesChatActionsTrigger(openMenu,{menuAnchor=it})
                        if(shortViewport)IconButton(onClick=closeDialog,modifier=Modifier.size(48.dp).testTag("hermes-chat-close").semantics{contentDescription="Close chat"}){Text("×",fontSize=28.sp)}
                    }
                }
                }
                }
            }
            // One stable popup callsite, outside both adaptive layout branches.
            if(menuOpen)HermesChatActionsMenu(state,menuViewport,menuAnchor,dismissMenu,menuEvent,onRead,{confirmClose=true},onClearChat,{confirmRecovery=true})
            if(confirmClose)AlertDialog(onDismissRequest={confirmClose=false},title={Text("Close unresolved request?")},text={Text("This fences further work, not a rollback. Earlier effects may have saved. The draft, history and recovery records are retained.")},confirmButton={TextButton(onClick={confirmClose=false;onNew()}){Text("Close request")}},dismissButton={TextButton(onClick={confirmClose=false}){Text("Keep request")}})
            if(confirmRecovery)AlertDialog(onDismissRequest={confirmRecovery=false},title={Text("Start separate local chat?")},text={Text("The original protected record will remain untouched. Earlier requests may have effects and are not reconciled. The current memory-only draft will be kept in a separate owner-bound record. Nothing is sent until a new explicit Send.")},confirmButton={TextButton(onClick={confirmRecovery=false;onRecover()}){Text("Start separate chat")}},dismissButton={TextButton(onClick={confirmRecovery=false}){Text("Keep original")}})
            if(continueChoice){
                val repeated=repeatsUnconfirmedHermesRequest(state)
                AlertDialog(onDismissRequest={continueChoice=false},title={Text(if(repeated)"Review earlier request" else "Continue with a new request?")},text={Text(if(repeated)
                    "This repeats an earlier unconfirmed request. Check its receipt and recorded effects before repeating. No new request has been sent."
                    else "The earlier request may have saved effects. Closing fences further work; it does not undo tasks. Your current draft stays intact. After a successful close, press Send separately to submit only this new draft.")},
                    confirmButton={if(repeated)TextButton(onClick={continueChoice=false;onRead()}){Text("Check receipt")} else TextButton(enabled=state.storageReady&&state.available&&!state.busy&&!state.receiptChecking&&needsHermesClose(state),onClick={continueChoice=false;onNew()}){Text("Close earlier request")}},
                    dismissButton={TextButton(onClick={continueChoice=false}){Text("Keep draft")}})
            }
        }
    }
}

@Composable private fun HermesChatActionsTrigger(onOpen:()->Unit,onAnchor:(Rect)->Unit){
    IconButton(onClick=onOpen,modifier=Modifier.size(48.dp).onGloballyPositioned{onAnchor(it.boundsInWindow())}.testTag("hermes-chat-actions").semantics{contentDescription="Conversation actions"}){Text("⋮",fontSize=24.sp)}
}

@Composable private fun HermesChatActionsMenu(state:HermesState,viewport:Rect,anchor:Rect,onDismiss:(String)->Unit,onEvent:(String)->Unit,onRead:()->Unit,onCloseRequest:()->Unit,onClearChat:()->Unit,onRecover:()->Unit){
    val density=LocalDensity.current
    val position=remember(viewport,anchor){object:PopupPositionProvider{
        override fun calculatePosition(anchorBounds:IntRect,windowSize:IntSize,layoutDirection:LayoutDirection,popupContentSize:IntSize):IntOffset{
            val left=viewport.left.toInt();val top=viewport.top.toInt()
            val right=(viewport.right.toInt()-popupContentSize.width).coerceAtLeast(left)
            val bottom=(viewport.bottom.toInt()-popupContentSize.height).coerceAtLeast(top)
            // The popup is hosted by the Dialog, not the replaceable icon node.
            val x=if(layoutDirection==LayoutDirection.Ltr)anchor.right.toInt()-popupContentSize.width else anchor.left.toInt()
            val y=if(anchor.bottom+popupContentSize.height<=viewport.bottom)anchor.bottom.toInt() else anchor.top.toInt()-popupContentSize.height
            return IntOffset(x.coerceIn(left,right),y.coerceIn(top,bottom))
        }
    }}
    // The usable landscape height can be shorter than standard menu margins.
    // Measure AND position against the same inset host, not screen bounds.
    // Keep a focusable popup for keyboard/accessibility dismissal; scrolling
    // exposes every action. Android may hide the editor IME while this owns focus;
    // the host restores it on ordinary dismissal only if it was visible on entry.
    if(viewport.width>0&&viewport.height>0)Popup(popupPositionProvider=position,onDismissRequest={onDismiss("popup")},properties=PopupProperties(focusable=true,clippingEnabled=false)){
        DisposableEffect(Unit){onEvent("popup:enter");onDispose{onEvent("popup:dispose")}}
        Surface(modifier=Modifier.widthIn(max=with(density){viewport.width.toDp()}).heightIn(max=with(density){viewport.height.toDp()}).testTag("hermes-chat-actions-menu"),shape=MaterialTheme.shapes.extraSmall,tonalElevation=3.dp,shadowElevation=3.dp){
            Column(Modifier.width(IntrinsicSize.Max).verticalScroll(rememberScrollState()).testTag("hermes-chat-actions-list").padding(vertical=4.dp)){
                DropdownMenuItem(text={Text("Check receipt")},enabled=!state.receiptChecking,onClick={onDismiss("receipt");onRead()})
                DropdownMenuItem(text={Text("New conversation")},enabled=state.storageReady&&!state.busy&&state.rootKey==null,onClick={onDismiss("new");onClearChat()})
                if(state.rootKey!=null)DropdownMenuItem(text={Text("Close unresolved request")},enabled=state.storageReady&&!state.busy,onClick={onDismiss("close-request");onCloseRequest()})
                if(state.canRecoverSeparately)DropdownMenuItem(text={Text("Start separate local chat")},onClick={onDismiss("recover");onRecover()})
            }
        }
    }
}

@Composable private fun HermesChatBubble(entry:HermesChatEntry,state:HermesState){
    var details by rememberSaveable(entry.id){mutableStateOf(false)}
    val receipt=state.receipt?.let{JSONObject(it)}?.takeIf{it.optString("key")==entry.turnKey}?:entry.receipt?.let{JSONObject(it)}
    Box(Modifier.fillMaxWidth(),contentAlignment=if(entry.role=="user")Alignment.CenterEnd else Alignment.CenterStart){
        Surface(Modifier.fillMaxWidth(.92f).testTag("chat-${entry.id}"),shape=MaterialTheme.shapes.medium,color=if(entry.role=="user")MaterialTheme.colorScheme.primary.copy(alpha=.18f) else MaterialTheme.colorScheme.surfaceVariant){
            Column(Modifier.padding(12.dp)){
                Text(if(entry.role=="user")"You" else "Hermes",style=MaterialTheme.typography.labelSmall)
                SelectionContainer{Text(entry.text.ifEmpty{if(entry.kind=="receipt"&&receipt!=null)receipt.getString("line") else "Message text expired."},fontSize=16.sp,lineHeight=24.sp,color=MaterialTheme.colorScheme.onSurface)}
                if(entry.kind=="receipt"){
                    TextButton(onClick={details=!details}){Text(if(details)"Hide details" else "View")}
                    if(details){
                        if(receipt==null)Text("Receipt reference: ${entry.turnKey}. Detailed field changes are not retained in this local history.",style=MaterialTheme.typography.bodySmall)
                        else{
                            Text("Outcome: ${receipt.getString("outcome")}. Verified: ${receipt.getInt("verified")}; expected: ${receipt.opt("expected")}.",style=MaterialTheme.typography.bodySmall)
                            receipt.getJSONArray("targets").objects().forEach { target->
                                Text("${target.getString("action")}: ${target.getString("title")}${if(target.has("date"))" · "+target.getString("date") else ""}")
                                Text("${target.getString("kind")} · ${target.getString("id")} · ${target.getString("state")} · ${target.getString("verification")}",style=MaterialTheme.typography.bodySmall)
                                val before=target.optJSONObject("before");val after=target.optJSONObject("after")
                                if(before!=null&&after!=null)(before.keys().asSequence().toSet()+after.keys().asSequence().toSet()).forEach{k->Text("$k: ${before.opt(k)?:"—"} → ${after.opt(k)?:"—"}",style=MaterialTheme.typography.bodySmall)}
                            }
                        }
                    }
                }
            }
        }
    }
}
