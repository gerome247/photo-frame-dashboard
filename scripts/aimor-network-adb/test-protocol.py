import socket
import struct
import threading
import time
import unittest
from proto import FrameReader, edu_pipeline, frame, parse_fields, _varint
from server import Session, ADB_COMMAND


class ProtocolTests(unittest.TestCase):
    def test_known_vector_and_fragmentation(self):
        # Independently fixed bytes: seq=1, header=110019, cmd=12006, msg=open.
        expected = bytes.fromhex('000000010001adc30000000920e65d2a046f70656e')
        packet = frame(1, 110019, edu_pipeline(12006, b'open'))
        self.assertEqual(packet, expected)
        reader = FrameReader()
        messages = []
        for byte in expected:
            messages.extend(reader.feed(bytes([byte])))
        self.assertEqual(len(messages), 1)
        self.assertEqual(parse_fields(messages[0][2]), {4: 12006, 5: b'open'})

    def test_malformed_input(self):
        for value in (-1, 2**64):
            with self.assertRaises(ValueError):
                _varint(value)
        for payload in (b'\x2a\x04a', b'\x20\x80', b'\0', b'\x20' + b'\xff' * 10):
            with self.assertRaises(ValueError):
                parse_fields(payload)
        for length in (-1, 65537):
            with self.assertRaises(ValueError):
                FrameReader().feed(struct.pack('>iii', 1, 110009, length))

    def test_login_gating_heartbeat_and_one_shot(self):
        events = []
        session = Session('127.0.0.1', lambda kind, **v: events.append((kind, v)))
        left, right = socket.socketpair()
        with left, right:
            worker = threading.Thread(target=session.handle,
                                      args=(left, '127.0.0.1', time.monotonic()+3))
            worker.start()
            right.settimeout(.15)
            right.sendall(frame(7, 999, b'ignored'))
            with self.assertRaises(socket.timeout):
                right.recv(1)
            right.sendall(frame(8, 101, b''))
            self.assertEqual(right.recv(12), frame(8, 101, b''))
            right.sendall(frame(9, 110009, b'private-login'))
            reader = FrameReader()
            messages = []
            while not messages:
                messages += reader.feed(right.recv(4096))
            self.assertEqual(messages[0][1], 110019)
            self.assertEqual(parse_fields(messages[0][2]), {4: 12009, 5: ADB_COMMAND.encode()})
            right.sendall(frame(10, 110009, b'private-login'))
            with self.assertRaises(socket.timeout):
                right.recv(1)
            right.shutdown(socket.SHUT_WR)
            worker.join(2)
            self.assertFalse(worker.is_alive())
        self.assertTrue(session.sent)
        self.assertEqual(sum(kind == 'runtime_adb_command_sent' for kind, _ in events), 1)
        self.assertNotIn('private-login', str(events))

    def test_wrong_peer(self):
        session = Session('127.0.0.1', lambda *a, **k: None)
        session.handle(None, '127.0.0.2', time.monotonic()+1)
        self.assertFalse(session.sent)


if __name__ == '__main__':
    unittest.main()
