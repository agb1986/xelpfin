import dgram from 'dgram';
import type { UdpReply, UdpTransport } from '../src/backend/jellyfin/discovery';

/** Node implementation of the discovery transport, for integration tests. Unicast only by default. */
export function nodeUdp(opts: { broadcast?: boolean } = {}): UdpTransport {
  return {
    broadcast(message, port, timeoutMs, extraHosts = []) {
      return new Promise((resolve, reject) => {
        const sock = dgram.createSocket('udp4');
        const replies: UdpReply[] = [];
        sock.on('message', (buf, rinfo) =>
          replies.push({
            address: rinfo.address,
            payload: buf.toString('utf8'),
          }),
        );
        sock.on('error', reject);
        sock.bind(0, () => {
          const targets = [...extraHosts];
          if (opts.broadcast) {
            sock.setBroadcast(true);
            targets.push('255.255.255.255');
          }
          for (const t of targets) {
            sock.send(message, port, t);
          }
          setTimeout(() => {
            sock.close();
            resolve(replies);
          }, timeoutMs);
        });
      });
    },
  };
}
