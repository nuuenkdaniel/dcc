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
class TimerModel:ViewModel() {
 private val mutable=MutableStateFlow(TimerState())
 val state=mutable.asStateFlow()
 private var deadline=0L
 init { viewModelScope.launch { while(true) { if(mutable.value.running)tick();delay(500) } } }
 private fun tick() {
  var s=mutable.value
  val now=SystemClock.elapsedRealtime()
  while(s.running && now>=deadline) {
   s=nextPhase(s)
   if(s.running)deadline+=s.remaining*1000
  }
  mutable.value=if(s.running)s.copy(remaining=((deadline-now+999)/1000).coerceAtLeast(0)) else s
 }
 fun toggle() { if(mutable.value.running){tick();mutable.value=mutable.value.copy(running=false)}else{deadline=SystemClock.elapsedRealtime()+mutable.value.remaining*1000;mutable.value=mutable.value.copy(running=true)} }
 fun reset(){val s=mutable.value;mutable.value=s.copy(index=0,onBreak=false,running=false,remaining=(s.steps.firstOrNull()?.minutes?:s.focus)*60L)}
 fun configure(focus:Int,rest:Int,steps:List<FocusStep>){mutable.value=TimerState(focus.coerceIn(1,180),rest.coerceIn(1,60),steps.take(20).map{it.copy(minutes=it.minutes.coerceIn(1,120))});reset()}
}
fun nextPhase(s:TimerState):TimerState = when {
 s.onBreak -> s.copy(index=0,onBreak=false,running=false,remaining=(s.steps.firstOrNull()?.minutes?:s.focus)*60L)
 s.index+1<s.steps.size -> s.copy(index=s.index+1,remaining=s.steps[s.index+1].minutes*60L)
 else -> s.copy(onBreak=true,remaining=s.rest*60L)
}
