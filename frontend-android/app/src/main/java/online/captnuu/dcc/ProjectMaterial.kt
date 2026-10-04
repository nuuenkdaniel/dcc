package online.captnuu.dcc

import java.io.InputStream
import java.io.ByteArrayOutputStream

fun readProjectMaterial(input:InputStream,limit:Int):ByteArray {
 val output=ByteArrayOutputStream()
 val buffer=ByteArray(8192)
 while(true){val count=input.read(buffer);if(count<0)break
  require(output.size()+count<=limit){"Maximum file size is 5 MB."}
  output.write(buffer,0,count)
 }
 return output.toByteArray()
}
