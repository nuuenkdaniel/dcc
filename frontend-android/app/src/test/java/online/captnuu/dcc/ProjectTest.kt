package online.captnuu.dcc
import org.junit.Assert.*
import org.junit.Test
class ProjectTest {
 @Test fun boundedUpload(){assertArrayEquals(byteArrayOf(1,2),readProjectMaterial(byteArrayOf(1,2).inputStream(),2))}
 @Test(expected=IllegalArgumentException::class) fun oversizedUpload(){readProjectMaterial(byteArrayOf(1,2,3).inputStream(),2)}
 @Test fun acceptsOptionalDeadline(){assertNull(projectFieldError("Essay","","60"))}
 @Test fun rejectsImpossibleDate(){assertNotNull(projectFieldError("Essay","2026-02-30","60"));assertNotNull(projectFieldError("Essay","2026-2-03","60"))}
 @Test fun validatesLimits(){assertNotNull(projectFieldError(" ","","60"));assertNotNull(projectFieldError("x".repeat(241),"","60"));assertNotNull(projectFieldError("Essay","","-1"));assertNotNull(projectFieldError("Essay","","100001"));assertNotNull(projectFieldError("Essay","","1.5"));assertNull(projectFieldError("Essay","2028-02-29","0"))}
}
