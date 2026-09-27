import hashlib, pathlib, subprocess, tempfile, unittest
from compressor import Compressor, Cancelled, FLAGS, ROOT

class CompressionChecks(unittest.TestCase):
    def test_actual_audio_mute_nonoverwrite_and_cancel(self):
        with tempfile.TemporaryDirectory(prefix='compressor-test-',dir=ROOT/'work') as folder:
            base=pathlib.Path(folder)
            source=base/'a clip with spaces & symbols.mkv'
            c=Compressor()
            subprocess.run([c.ffmpeg,'-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x240:rate=30:duration=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-preset','ultrafast','-c:a','aac',str(source)],check=True,creationflags=FLAGS)
            original=hashlib.sha256(source.read_bytes()).hexdigest()
            one=c.compress(source,1,720,True)
            self.assertLessEqual(one['after'],1_000_000)
            self.assertTrue(c.probe(one['output'])['audio'])
            two=c.compress(source,1,720,False)
            self.assertNotEqual(one['output'],two['output'])
            self.assertTrue(pathlib.Path(one['output']).exists())
            self.assertFalse(c.probe(two['output'])['audio'])
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),original)
            self.assertEqual(c.probe(two['output'])['video']['width'],320)
            self.assertTrue(c.compress(two['output'],1)['skipped'])
            cancel=Compressor()
            def cancel_on_encode(p,s):
                if p>0:cancel.cancel()
            with self.assertRaises(Cancelled):cancel.compress(source,1,720,report=cancel_on_encode)
            self.assertEqual(len(list((base/'Shared').glob('*.mp4'))),2)
            self.assertEqual(list((base/'Shared').glob('.compress-*')),[])
            with self.assertRaises(ValueError):c.compress(source,float('nan'))
            bad=base/'broken.mp4';bad.write_text('not a video')
            with self.assertRaises(ValueError):c.compress(bad,1)

if __name__=='__main__':unittest.main()
