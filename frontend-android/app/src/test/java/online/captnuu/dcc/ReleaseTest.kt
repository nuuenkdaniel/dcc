package online.captnuu.dcc
import org.junit.Test
import org.junit.Assert.*
class ReleaseTest {
 @Test fun stableVersions(){assertTrue(newerRelease("v1.10.0","1.9.9"));assertFalse(newerRelease("v1.0.0","1.0.0"));assertFalse(newerRelease("v1.0.0-beta","0.1.0"));assertFalse(newerRelease("bad","0.1.0"));assertFalse(newerRelease("v0.0.9","0.1.0"))}
}
