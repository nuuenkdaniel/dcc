import http.client
import json
import os
from pathlib import Path
from runpy import run_path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch


class CuratorAdmissionTest(unittest.TestCase):
    def test_background_work_does_not_displace_chat_and_overlapping_chat_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory, 'token')
            token.write_text('synthetic-' + 'x' * 40)
            with patch.dict(os.environ, {'DAYMARK_CURATOR_TOKEN_FILE': str(token), 'DAYMARK_TASK_ACTIONS_ENABLED': '1'}):
                bridge = run_path(str(Path(__file__).with_name('curator_bridge.py')))
                server = bridge['ThreadingHTTPServer'](('127.0.0.1', 0), bridge['Handler'])
                threading.Thread(target=server.serve_forever, daemon=True).start()
                background_entered, chat_entered, release = (threading.Event() for _ in range(3))

                def simulated_run(*args, **kwargs):
                    invocation = json.loads(kwargs['input'])
                    signal = chat_entered if invocation.get('chatVersion') == 1 else background_entered
                    signal.set()
                    if not release.wait(5):
                        raise AssertionError('Test gate timed out')
                    return subprocess.CompletedProcess(args, 0, json.dumps({'status': 'finished', 'replyVersion': 1}))

                def post(payload):
                    connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
                    try:
                        connection.request('POST', '/curate', json.dumps(payload), {'Authorization': 'Bearer ' + token.read_text()})
                        response = connection.getresponse()
                        return response.status, json.loads(response.read())
                    finally:
                        connection.close()

                chat = {'mode': 'product-action', 'prompt': 'Synthetic question',
                        'callbackCapability': 'a' * 64, 'expiresAt': int(time.time() * 1000) + 60000,
                        'replyVersion': 1, 'chatVersion': 1}
                results = []
                background = threading.Thread(target=lambda: results.append(post({'mode': 'mail-classify'})))
                active_chat = threading.Thread(target=lambda: results.append(post(chat)))
                try:
                    with patch.object(subprocess, 'run', side_effect=simulated_run):
                        background.start()
                        self.assertTrue(background_entered.wait(2))
                        active_chat.start()
                        try:
                            self.assertTrue(chat_entered.wait(2))
                            self.assertEqual(post(chat), (429, {'error': 'Curator busy'}))
                        finally:
                            release.set()
                            background.join()
                            active_chat.join()
                    self.assertEqual([200, 200], sorted(status for status, _ in results))
                finally:
                    release.set()
                    server.shutdown()
                    server.server_close()
