import socket
import struct
import threading
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from dns import Resolver, HOSTNAME, ALTERNATE_HOSTNAME, UDPServer, TCPServer, UDPHandler, TCPHandler, read_exact, client_allowed


def query(host=HOSTNAME, kind=1):
    name = b''.join(bytes([len(label)]) + label.encode() for label in host.split('.')) + b'\0'
    return struct.pack('!6H', 123, 0x100, 1, 0, 0, 0) + name + struct.pack('!HH', kind, 1)


class DNSTests(unittest.TestCase):
    def test_selected_production_command_host_only(self):
        self.assertEqual(HOSTNAME, 'imsconnect.efercro.com')
        resolver = Resolver('192.168.50.23', upstreams=())
        reply = resolver.reply(query('imsconnect.efercro.com'))
        self.assertEqual(reply[-4:], socket.inet_aton('192.168.50.23'))
        self.assertEqual(struct.unpack('!6H', reply[:12])[3], 1)
        for host in (ALTERNATE_HOSTNAME, 'imsaccount.efercro.com', 'example.com'):
            other = resolver.reply(query(host))
            self.assertEqual(struct.unpack('!6H', other[:12])[1] & 15, 2)

    def test_reloadable_verified_clients_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'clients.json'
            server = SimpleNamespace(allowed={'192.168.50.1'}, clients_file=path)
            path.write_text('["192.168.50.57"]')
            self.assertTrue(client_allowed(server, '192.168.50.57'))
            self.assertFalse(client_allowed(server, '192.168.50.58'))
            path.write_text('["192.168.50.58"]')
            self.assertTrue(client_allowed(server, '192.168.50.58'))
            self.assertFalse(client_allowed(server, '192.168.50.57'))
            for content in ('[', '["8.8.8.8"]', '{}', '[1]', '[]', ' ' * 4097):
                path.write_text(content)
                self.assertFalse(client_allowed(server, '192.168.50.58'))
                self.assertTrue(client_allowed(server, '192.168.50.1'))
            path.unlink()
            self.assertFalse(client_allowed(server, '192.168.50.58'))

    def test_only_command_host_is_overridden(self):
        resolver = Resolver('192.168.50.23', upstreams=())
        answer = resolver.reply(query())
        self.assertEqual(struct.unpack('!6H', answer[:12]), (123, 0x8180, 1, 1, 0, 0))
        self.assertEqual(answer[-4:], socket.inet_aton('192.168.50.23'))
        ipv6 = resolver.reply(query(kind=28))
        self.assertEqual(struct.unpack('!6H', ipv6[:12])[3], 0)
        other = resolver.reply(query('imsaccount.efercro.com'))
        self.assertEqual(struct.unpack('!6H', other[:12])[1] & 15, 2)
        for malformed in (b'', query()[:20], b'\0' * 12):
            with self.assertRaises(ValueError):
                resolver.reply(malformed)

    def test_real_udp_and_tcp_loopback(self):
        resolver = Resolver('127.0.0.1', upstreams=())
        for cls, handler, proto in ((UDPServer, UDPHandler, socket.SOCK_DGRAM),
                                    (TCPServer, TCPHandler, socket.SOCK_STREAM)):
            with cls(('127.0.0.1', 0), handler) as server:
                server.resolver, server.allowed, server.bind_ip = resolver, {'127.0.0.1'}, '127.0.0.1'
                worker = threading.Thread(target=server.serve_forever)
                worker.start()
                try:
                    with socket.socket(socket.AF_INET, proto) as client:
                        client.settimeout(2)
                        client.connect(server.server_address)
                        packet = query()
                        client.sendall(packet if proto == socket.SOCK_DGRAM else struct.pack('!H', len(packet))+packet)
                        reply = client.recv(4096) if proto == socket.SOCK_DGRAM else read_exact(client, struct.unpack('!H', read_exact(client, 2))[0])
                        self.assertEqual(reply, resolver.reply(packet))
                finally:
                    server.shutdown()
                    worker.join(2)


if __name__ == '__main__':
    unittest.main()
