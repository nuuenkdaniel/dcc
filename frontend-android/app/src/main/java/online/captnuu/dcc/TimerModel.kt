package online.captnuu.dcc

import android.os.SystemClock
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class FocusStep(val name:String,val minutes:Int)
data class TimerState(val focus:Int=25,val rest:Int=5,val steps:List<FocusStep> = emptyList(),val index:Int=0,val onBreak:Boolean=false,val remaining:Long=1500,val running:Boolean=false) {
 val label:String get()=if(onBreak)"Break" else steps.getOrNull(index)?.name?:"Focus"
}
class TimerModel(application:android.app.Application):androidx.lifecycle.AndroidViewModel(application) {
 private val storage=TimerStorage(application)
 private val mutable=MutableStateFlow(storage.advance())
 val state=mutable.asStateFlow()
 init {val (s,d)=storage.load();storage.schedule(s,d)}
 fun refreshDisplay(){mutable.value=storage.advance()}
 fun toggle(){val s=storage.advance();val next=s.copy(running=!s.running);storage.write(next,System.currentTimeMillis()+next.remaining*1000);mutable.value=next}
 fun reset(){val s=mutable.value;val next=s.copy(index=0,onBreak=false,running=false,remaining=(s.steps.firstOrNull()?.minutes?:s.focus)*60L);storage.write(next,0);mutable.value=next}
 fun configure(focus:Int,rest:Int,steps:List<FocusStep>){mutable.value=TimerState(focus.coerceIn(1,180),rest.coerceIn(1,60),steps.take(20).map{it.copy(minutes=it.minutes.coerceIn(1,120))});reset()}
}
fun nextPhase(s:TimerState):TimerState = when {
 s.onBreak -> s.copy(index=0,onBreak=false,running=false,remaining=(s.steps.firstOrNull()?.minutes?:s.focus)*60L)
 s.index+1<s.steps.size -> s.copy(index=s.index+1,remaining=s.steps[s.index+1].minutes*60L)
 else -> s.copy(onBreak=true,remaining=s.rest*60L)
}
