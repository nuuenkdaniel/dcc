package online.captnuu.dcc

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import java.time.*
import java.time.format.DateTimeFormatter
import org.json.JSONObject

@Composable fun MonthCalendar(selected:String,month:String,select:(String)->Unit,changeMonth:(String)->Unit) {
 val current=YearMonth.parse(month)
 Column {
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
   TextButton(onClick={changeMonth(current.minusMonths(1).toString())},modifier=Modifier.semantics{contentDescription="Previous month"}){Text("‹")}
   TextButton(onClick={changeMonth(YearMonth.now().toString());select(LocalDate.now().toString())}){Text(current.format(DateTimeFormatter.ofPattern("MMMM yyyy")))}
   TextButton(onClick={changeMonth(current.plusMonths(1).toString())},modifier=Modifier.semantics{contentDescription="Next month"}){Text("›")}
  }
  Row { listOf("M","T","W","T","F","S","S").forEach { Text(it,modifier=Modifier.weight(1f),textAlign=androidx.compose.ui.text.style.TextAlign.Center,style=MaterialTheme.typography.labelSmall) } }
  val start=current.atDay(1).minusDays((current.atDay(1).dayOfWeek.value-1).toLong())
  val weeks=(current.atDay(1).dayOfWeek.value-1+current.lengthOfMonth()+6)/7
  repeat(weeks) { week -> Row {
   repeat(7) { col -> val day=start.plusDays((week*7+col).toLong());val chosen=day.toString()==selected
    TextButton(onClick={select(day.toString())},modifier=Modifier.weight(1f).heightIn(min=48.dp).semantics{contentDescription=day.toString();this.selected=chosen},contentPadding=PaddingValues(0.dp),shape=androidx.compose.foundation.shape.RoundedCornerShape(8.dp),colors=ButtonDefaults.textButtonColors(containerColor=if(chosen)MaterialTheme.colorScheme.secondaryContainer else androidx.compose.ui.graphics.Color.Transparent)) {
     Column(horizontalAlignment=androidx.compose.ui.Alignment.CenterHorizontally) {
      Text(day.dayOfMonth.toString(),color=if(YearMonth.from(day)==current)MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
      if(day==LocalDate.now())Text("•",style=MaterialTheme.typography.labelSmall)
     }
    }
   }
  } }
 }
}
fun eventTimeLabel(e:JSONObject):String {
 if(e.optBoolean("allDay"))return "All day"
 val zone=ZoneId.systemDefault();val format=DateTimeFormatter.ofPattern("h:mm a")
 return try { eventInstant(e.getString("start"),zone).atZone(zone).format(format)+" – "+eventInstant(e.getString("end"),zone).atZone(zone).format(format) }
 catch (_:Exception) { "Time unavailable" }
}
