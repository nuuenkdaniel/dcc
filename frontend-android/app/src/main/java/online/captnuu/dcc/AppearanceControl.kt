package online.captnuu.dcc
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
@Composable fun AppearanceControl(){
 val context=LocalContext.current;val prefs=remember{context.getSharedPreferences("dcc-preferences",0)};var choice by remember{mutableStateOf(prefs.getString("theme","dark")?:"dark")}
 Text("Appearance",style=MaterialTheme.typography.titleSmall)
 Row{listOf("dark","light","system").forEach{value->FilterChip(choice==value,{choice=value;prefs.edit().putString("theme",value).apply()},label={Text(value.replaceFirstChar{it.uppercase()})})}}
}
