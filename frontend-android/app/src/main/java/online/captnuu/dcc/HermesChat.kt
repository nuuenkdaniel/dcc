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
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.input.key.*
import org.json.JSONObject

internal val HermesChatImeBottom=SemanticsPropertyKey<Int>("HermesChatImeBottom")
// Workspace provides this around both production and fixture hosts. Claim IME
// ownership in the opening event, before the Dialog can show its keyboard.
internal val LocalHermesModalVisibility=staticCompositionLocalOf<(Boolean)->Unit>{{}}

/** Modal window, not a replacement composition for the workspace. Dismissal is
 * deliberately presentation-only: no controller close, abort, edit or network. */
@OptIn(ExperimentalComposeUiApi::class)
@Composable internal fun HermesChatHost(state:HermesState,onEdit:(String)->Unit,onSend:()->Unit,onNew:()->Unit,onRead:()->Unit,onClearChat:()->Unit,modifier:Modifier){
    val modalVisibility=LocalHermesModalVisibility.current
    key(state.ownerKey){
        var open by rememberSaveable{mutableStateOf(false)}
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
        val send={showChat();onSend()}
        // This is a typeable entrance, not a second selection owner. Focus/click
        // and blur may collapse its cursor without editing text; those callbacks
        // must not replace the chat's saved range or reopen a dismissed window.
        OutlinedTextField(value,{v->if(v.text!=text){showChat();change(v)}},modifier=modifier.heightIn(min=48.dp).testTag("hermes-editor").onFocusChanged{if(it.isFocused)showChat()},label={Text("Hermes")},singleLine=true,
            trailingIcon={
                if(state.busy||state.rootKey!=null||state.timeline.isNotEmpty()||state.receipt!=null){
                    Text(if(state.busy)"…" else "•",modifier=Modifier.semantics{contentDescription=if(state.busy)"Chat request pending" else "Resume local chat"})
                }
            },
            keyboardOptions=KeyboardOptions(imeAction=ImeAction.Send),keyboardActions=KeyboardActions(onSend={send()}))
        LaunchedEffect(open){if(open)workspaceFocus.clearFocus(force=true)}
        if(open)Dialog(onDismissRequest=close,properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false,dismissOnClickOutside=false)){
            val chatFocus=LocalFocusManager.current;val chatKeyboard=LocalSoftwareKeyboardController.current
            // Fence synchronous selection-collapse callbacks before clearing focus.
            val closeDialog={closing.value=true;chatFocus.clearFocus(force=true);chatKeyboard?.hide();close()}
            val latestClose by rememberUpdatedState(closeDialog)
            val dialogView=LocalView.current
            // Back is a UI close even with the IME open. The overlay-priority
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
            val imeBottom=WindowInsets.ime.getBottom(LocalDensity.current)
            val focus=remember{FocusRequester()}
            val entries=visibleChat(state)
            var confirmClose by remember{mutableStateOf(false)}
            var requestedKeyboard by remember{mutableStateOf(false)}
            Surface(Modifier.fillMaxSize().testTag("hermes-chat").semantics{this[HermesChatImeBottom]=imeBottom},color=MaterialTheme.colorScheme.background){
                Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars).imePadding()){
                BoxWithConstraints(Modifier.fillMaxSize().testTag("hermes-chat-content")){
                val shortViewport=maxHeight<320.dp
                // The short layout replaces the editor node, but keeps the same
                // controlled value/selection and restores its IME focus.
                LaunchedEffect(shortViewport){focus.requestFocus();if(!requestedKeyboard){chatKeyboard?.show();requestedKeyboard=true}}
                val signature=entries.lastOrNull()?.let{it.id+it.text+it.receipt}.orEmpty()+state.busy
                LaunchedEffect(signature){if(signature!=displayed&&entries.isNotEmpty())list.animateScrollToItem(entries.lastIndex+if(shortViewport)1 else 0);displayed=signature}
                Column(Modifier.fillMaxSize()){
                    if(!shortViewport){
                    Row(Modifier.fillMaxWidth().padding(horizontal=12.dp),verticalAlignment=Alignment.CenterVertically){
                        Text("Hermes",style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f))
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
                            if(state.notice.isNotBlank()&&entries.lastOrNull()?.text!=state.notice)item(key="chat-status"){Text(state.notice,Modifier.testTag("hermes-chat-status"),style=MaterialTheme.typography.bodySmall)}
                            item(key="chat-actions"){
                                Column{
                                    Text("Conversation actions",style=MaterialTheme.typography.labelMedium)
                                    HermesChatActions(state,onRead,{confirmClose=true},onClearChat)
                                }
                            }
                        }
                    }
                    if(!shortViewport){
                    if(state.notice.isNotBlank()&&entries.lastOrNull()?.text!=state.notice)Text(state.notice,Modifier.padding(horizontal=12.dp,vertical=4.dp).testTag("hermes-chat-status"),style=MaterialTheme.typography.bodySmall)
                    HermesChatActions(state,onRead,{confirmClose=true},onClearChat)
                    }
                    Row(Modifier.fillMaxWidth().padding(horizontal=if(shortViewport)4.dp else 8.dp,vertical=if(shortViewport)0.dp else 8.dp).testTag("hermes-chat-composer"),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(4.dp)){
                        val editorModifier=Modifier.weight(1f).heightIn(min=48.dp).focusRequester(focus).onPreInterceptKeyBeforeSoftKeyboard{event->
                            if(event.key==Key.Back){if(event.type==KeyEventType.KeyUp)closeDialog();true}else false
                        }.testTag("hermes-chat-editor")
                        if(shortViewport){
                            BasicTextField(value,change,modifier=editorModifier.height(48.dp).background(MaterialTheme.colorScheme.surfaceVariant,MaterialTheme.shapes.small).border(1.dp,MaterialTheme.colorScheme.outline,MaterialTheme.shapes.small).semantics{contentDescription=if(answering(state))"Answer Hermes" else "Hermes"},singleLine=true,maxLines=1,textStyle=LocalTextStyle.current.copy(fontSize=16.sp,color=MaterialTheme.colorScheme.onSurface),cursorBrush=SolidColor(MaterialTheme.colorScheme.primary),keyboardOptions=KeyboardOptions(imeAction=ImeAction.Send),keyboardActions=KeyboardActions(onSend={send()}),decorationBox={editor->
                                Box(Modifier.fillMaxSize().padding(horizontal=8.dp),contentAlignment=Alignment.CenterStart){
                                    if(text.isEmpty())Text(if(answering(state))"Answer Hermes" else "Hermes",fontSize=16.sp)
                                    editor()
                                }
                            })
                        }else{
                            OutlinedTextField(value,change,label={Text(if(answering(state))"Answer Hermes" else "Hermes")},modifier=editorModifier,maxLines=4,keyboardOptions=KeyboardOptions(imeAction=ImeAction.Send),keyboardActions=KeyboardActions(onSend={send()}))
                        }
                        Button(onClick=send,enabled=!state.busy&&text.isNotBlank(),modifier=Modifier.height(48.dp).testTag("hermes-chat-send"),contentPadding=PaddingValues(horizontal=12.dp,vertical=0.dp)){Text("Send",maxLines=1)}
                        if(shortViewport)IconButton(onClick=closeDialog,modifier=Modifier.size(48.dp).testTag("hermes-chat-close").semantics{contentDescription="Close chat"}){Text("×",fontSize=28.sp)}
                    }
                }
                }
                }
            }
            if(confirmClose)AlertDialog(onDismissRequest={confirmClose=false},title={Text("Close unresolved request?")},text={Text("This fences further work, not a rollback. Earlier effects may have saved. The draft, history and recovery records are retained.")},confirmButton={TextButton(onClick={confirmClose=false;onNew()}){Text("Close request")}},dismissButton={TextButton(onClick={confirmClose=false}){Text("Keep request")}})
        }
    }
}

@Composable private fun HermesChatActions(state:HermesState,onRead:()->Unit,onCloseRequest:()->Unit,onClearChat:()->Unit){
    Row(Modifier.fillMaxWidth().padding(horizontal=4.dp),horizontalArrangement=Arrangement.spacedBy(4.dp)){
        if(!state.busy&&(state.rootKey!=null||state.submitted?.closed==true))TextButton(onClick=onRead){Text("Check receipt")}
        if(state.rootKey!=null)TextButton(onClick=onCloseRequest,enabled=!state.busy){Text("Close unresolved request")}
        else TextButton(onClick=onClearChat,enabled=!state.busy){Text("New conversation")}
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
