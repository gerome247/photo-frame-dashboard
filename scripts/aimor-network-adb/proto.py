"""Minimal protobuf + AiMOR frame codec. No deps."""
import struct

def _varint(n):
    if not isinstance(n, int) or not 0 <= n < 2**64:
        raise ValueError('Expected an unsigned 64-bit integer')
    out = bytearray()
    while True:
        b = n & 0x7f
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)

def field_varint(fnum, val):
    return _varint((fnum << 3) | 0) + _varint(val)

def field_bytes(fnum, data):
    return _varint((fnum << 3) | 2) + _varint(len(data)) + data

def edu_pipeline(cmd, msg: bytes):
    # EduPipelineMessage: field4 cmd (int32), field5 msg (bytes)
    return field_varint(4, cmd) + field_bytes(5, msg)

def frame(seq, header_cmd, payload: bytes):
    # MineDecoder wire: [seq int32][cmd int32][len int32][payload], big-endian
    if len(payload) > 65536:
        raise ValueError('Payload too large')
    return struct.pack('>iii', seq, header_cmd, len(payload)) + payload

# --- decoder for self-test ---
def read_varint(b, i):
    shift = 0; val = 0
    while True:
        if i >= len(b) or shift >= 64:
            raise ValueError('Truncated or oversized varint')
        x = b[i]; i += 1
        if shift == 63 and x > 1:
            raise ValueError('Oversized varint')
        val |= (x & 0x7f) << shift
        if not (x & 0x80):
            return val, i
        shift += 7

def parse_fields(b):
    i = 0; out = {}
    while i < len(b):
        key, i = read_varint(b, i)
        fnum, wt = key >> 3, key & 7
        if fnum == 0:
            raise ValueError('Invalid protobuf field')
        if wt == 0:
            v, i = read_varint(b, i)
        elif wt == 2:
            ln, i = read_varint(b, i)
            if ln > len(b) - i:
                raise ValueError('Truncated bytes field')
            v = b[i:i+ln]; i += ln
        else:
            raise ValueError(f"wiretype {wt}")
        out[fnum] = v
    return out

CMD_PIP_HEAD = 110019
RECEIVE_SHELL_COMMAND = 12009
RECEIVE_SWITCH_ADB = 12006


class FrameReader:
    """Bounded incremental reader; do not retain or log received login payloads."""
    def __init__(self):
        self.buffer = bytearray()

    def feed(self, data):
        self.buffer.extend(data)
        if len(self.buffer) > 131072:
            raise ValueError('Input buffer too large')
        messages = []
        while len(self.buffer) >= 12:
            seq, cmd, length = struct.unpack('>iii', self.buffer[:12])
            if length < 0 or length > 65536:
                raise ValueError('Invalid frame length')
            if len(self.buffer) < 12 + length:
                break
            messages.append((seq, cmd, bytes(self.buffer[12:12+length])))
            del self.buffer[:12+length]
        return messages
