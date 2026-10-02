/**
 * Development seed.
 *
 * Produces a college that looks like a real one mid-term: a populated question
 * bank, several quizzes at different points in their lifecycle, and a spread of
 * completed attempts — including a couple with genuine integrity signals, so
 * the review workflow can be exercised without inventing them by hand.
 *
 * Safe to re-run: it clears the tables it owns first.
 */
import { PrismaClient, type Difficulty, type ExamEventType, type QuestionType } from '@prisma/client';
import { randomInt } from 'node:crypto';

// Relative rather than aliased: this script runs outside the Next.js module
// resolver. Grading here goes through the same pure functions the exam uses,
// so seeded results and live results can never drift apart.
import {
  ASSERTION_REASON_OPTIONS,
  TRUE_FALSE_OPTIONS,
  gradeAnswer,
  type GradableQuestion,
} from '../src/lib/grading';

const prisma = new PrismaClient();

function pick<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length)]!;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const SUBJECTS = [
  {
    name: 'Computer Networks',
    code: 'CS304',
    topics: [
      'Networking Basics',
      'Transport Layer',
      'Application Layer',
      'Network Security',
      // Holds one question of each non-multiple-choice type, so the
      // "Applied Problems" quiz below demonstrates all of them together.
      'Applied Problems',
    ],
  },
  {
    name: 'Operating Systems',
    code: 'CS302',
    topics: ['Process Management', 'Memory Management', 'File Systems', 'Concurrency'],
  },
  {
    name: 'Database Systems',
    code: 'CS303',
    topics: ['Relational Model', 'Normalization', 'Transactions', 'Indexing'],
  },
];

interface SeedQuestion {
  text: string;
  /** Omitted for written and uploaded answers; fixed sets are filled in below. */
  options?: string[];
  /** Index, or several indexes for a multiple-select question. */
  correct?: number | number[];
  type?: QuestionType;
  difficulty: Difficulty;
  topic: string;
  explanation?: string;
  assertion?: string;
  reason?: string;
  acceptedAnswers?: string[];
  numericTolerance?: number;
  modelAnswer?: string;
  maxWords?: number;
  /** Responses the simulated attempts write, so a marker sees a coherent pair. */
  sampleAnswers?: { good: string; weak: string };
}

const QUESTIONS: Record<string, SeedQuestion[]> = {
  CS304: [
    {
      text: 'Which protocol is responsible for reliable, ordered delivery of a byte stream between applications?',
      options: ['TCP', 'UDP', 'HTTP', 'FTP'],
      correct: 0,
      difficulty: 'EASY',
      topic: 'Transport Layer',
      explanation:
        'TCP is connection-oriented and provides acknowledgements, retransmission and sequencing. UDP offers none of these.',
    },
    {
      text: 'At which OSI layer does a router primarily operate?',
      options: ['Data link layer', 'Network layer', 'Transport layer', 'Session layer'],
      correct: 1,
      difficulty: 'EASY',
      topic: 'Networking Basics',
      explanation: 'Routers forward packets using logical (IP) addresses, which is layer 3.',
    },
    {
      text: 'What is the default port number for HTTPS?',
      options: ['21', '80', '443', '8080'],
      correct: 2,
      difficulty: 'EASY',
      topic: 'Application Layer',
      explanation: 'HTTPS uses TCP port 443 by convention; 80 is plain HTTP.',
    },
    {
      text: 'Which mechanism does TCP use to avoid overwhelming a slow receiver?',
      options: ['Congestion control', 'Flow control', 'Error correction', 'Fragmentation'],
      correct: 1,
      difficulty: 'MEDIUM',
      topic: 'Transport Layer',
      explanation:
        'Flow control uses the receiver-advertised window. Congestion control responds to the network, not the receiver.',
    },
    {
      text: 'In the TCP three-way handshake, which flags are set on the second segment?',
      options: ['SYN only', 'ACK only', 'SYN and ACK', 'FIN and ACK'],
      correct: 2,
      difficulty: 'MEDIUM',
      topic: 'Transport Layer',
      explanation: 'The server responds to the client SYN with a segment carrying both SYN and ACK.',
    },
    {
      text: 'Which record type does DNS use to map a hostname to an IPv6 address?',
      options: ['A', 'AAAA', 'CNAME', 'MX'],
      correct: 1,
      difficulty: 'MEDIUM',
      topic: 'Application Layer',
      explanation: 'A maps to IPv4; AAAA (“quad-A”) maps to IPv6.',
    },
    {
      text: 'What is the primary purpose of ARP in an IPv4 network?',
      options: [
        'Resolving domain names to IP addresses',
        'Resolving IP addresses to MAC addresses',
        'Assigning IP addresses dynamically',
        'Encrypting link-layer frames',
      ],
      correct: 1,
      difficulty: 'MEDIUM',
      topic: 'Networking Basics',
      explanation: 'ARP maps a known layer-3 address to the layer-2 address needed to deliver the frame.',
    },
    {
      text: 'Which statement about TLS 1.3 is correct?',
      options: [
        'It removes support for forward secrecy',
        'It completes the handshake in one round trip',
        'It mandates RSA key transport',
        'It operates at the network layer',
      ],
      correct: 1,
      difficulty: 'HARD',
      topic: 'Network Security',
      explanation:
        'TLS 1.3 reduces the full handshake to 1-RTT and removes static RSA key exchange, requiring forward secrecy.',
    },
    {
      text: 'A subnet mask of 255.255.255.192 provides how many usable host addresses per subnet?',
      options: ['30', '62', '126', '254'],
      correct: 1,
      difficulty: 'HARD',
      topic: 'Networking Basics',
      explanation: '/26 leaves 6 host bits: 2^6 = 64 addresses, minus network and broadcast = 62.',
    },
    {
      text: 'Which attack does HSTS specifically mitigate?',
      options: [
        'SQL injection',
        'SSL stripping downgrade attacks',
        'Cross-site scripting',
        'ARP spoofing',
      ],
      correct: 1,
      difficulty: 'HARD',
      topic: 'Network Security',
      explanation:
        'HSTS instructs the browser to use HTTPS only, preventing an attacker from downgrading the connection to HTTP.',
    },
    {
      text: 'What does the TTL field in an IP header prevent?',
      options: [
        'Packet fragmentation',
        'Infinite routing loops',
        'Duplicate acknowledgements',
        'Checksum errors',
      ],
      correct: 1,
      difficulty: 'EASY',
      topic: 'Networking Basics',
      explanation: 'Each hop decrements TTL; at zero the packet is discarded, bounding loops.',
    },
    {
      text: 'Which HTTP status code indicates that the client must authenticate to get the requested response?',
      options: ['400', '401', '403', '404'],
      correct: 1,
      difficulty: 'EASY',
      topic: 'Application Layer',
      explanation: '401 means unauthenticated; 403 means authenticated but not permitted.',
    },
    {
      text: 'Why is UDP preferred for live video streaming?',
      options: [
        'It guarantees ordered delivery',
        'It has lower latency and tolerates loss',
        'It encrypts payloads by default',
        'It supports larger payloads than TCP',
      ],
      correct: 1,
      difficulty: 'MEDIUM',
      topic: 'Transport Layer',
      explanation:
        'Retransmitting a late video frame is useless, so the lower overhead of UDP is a better trade.',
    },
    {
      text: 'What is the function of NAT in a home router?',
      options: [
        'Translating private addresses to a public address',
        'Encrypting all outbound traffic',
        'Assigning MAC addresses',
        'Compressing HTTP responses',
      ],
      correct: 0,
      difficulty: 'MEDIUM',
      topic: 'Networking Basics',
      explanation: 'NAT lets many private hosts share one routable public IP address.',
    },
    {
      text: 'Which field in the TCP header enables selective acknowledgement (SACK)?',
      options: ['The urgent pointer', 'A TCP option', 'The reserved bits', 'The window field'],
      correct: 1,
      difficulty: 'HARD',
      topic: 'Transport Layer',
      explanation: 'SACK is negotiated and carried in the TCP options area, not in a fixed header field.',
    },
    {
      text: 'What distinguishes a switch from a hub?',
      options: [
        'A switch forwards frames only to the destination port',
        'A switch operates at the network layer',
        'A hub supports VLANs',
        'A hub performs error correction',
      ],
      correct: 0,
      difficulty: 'EASY',
      topic: 'Networking Basics',
      explanation: 'A switch learns MAC addresses and forwards selectively; a hub repeats to every port.',
    },
    {
      text: 'In DNS, what is the purpose of a CNAME record?',
      options: [
        'To alias one hostname to another',
        'To designate a mail server',
        'To hold arbitrary text',
        'To delegate a zone',
      ],
      correct: 0,
      difficulty: 'MEDIUM',
      topic: 'Application Layer',
      explanation: 'A CNAME points a name at another name, which is then resolved in turn.',
    },
    {
      text: 'Which of these is a link-state routing protocol?',
      options: ['RIP', 'BGP', 'OSPF', 'ARP'],
      correct: 2,
      difficulty: 'HARD',
      topic: 'Networking Basics',
      explanation: 'OSPF floods link-state advertisements and runs Dijkstra locally. RIP is distance-vector.',
    },
    {
      text: 'What does a CSRF token protect against?',
      options: [
        'An attacker reading a response cross-origin',
        'A forged state-changing request from another site',
        'Password brute-forcing',
        'Packet sniffing on a shared network',
      ],
      correct: 1,
      difficulty: 'HARD',
      topic: 'Network Security',
      explanation:
        'The token proves the request came from the application’s own pages, which a cross-site attacker cannot read.',
    },
    {
      text: 'Which layer of the TCP/IP model does Ethernet belong to?',
      options: ['Application', 'Transport', 'Internet', 'Link'],
      correct: 3,
      difficulty: 'EASY',
      topic: 'Networking Basics',
      explanation: 'Ethernet defines framing and media access, which is the link layer.',
    },
  ],
  CS302: [
    {
      text: 'What is a race condition?',
      options: [
        'Two processes competing for CPU time',
        'Behaviour that depends on the unpredictable timing of concurrent operations',
        'A deadlock between two threads',
        'A process exceeding its memory quota',
      ],
      correct: 1,
      difficulty: 'MEDIUM',
      topic: 'Concurrency',
      explanation:
        'The defect is the dependence on interleaving order, not the competition for resources itself.',
    },
    {
      text: 'Which scheduling algorithm can cause starvation of long jobs?',
      options: ['First-come first-served', 'Shortest job first', 'Round robin', 'FIFO with ageing'],
      correct: 1,
      difficulty: 'MEDIUM',
      topic: 'Process Management',
      explanation: 'SJF always favours short jobs, so a long job may never be scheduled under continuous load.',
    },
    {
      text: 'What does the “dirty bit” in a page table entry indicate?',
      options: [
        'The page is currently locked',
        'The page has been modified since being loaded',
        'The page is shared between processes',
        'The page is invalid',
      ],
      correct: 1,
      difficulty: 'MEDIUM',
      topic: 'Memory Management',
      explanation: 'A clean page can be evicted without a write-back; a dirty page must be written to disk first.',
    },
    {
      text: 'Which of the four Coffman conditions must hold for deadlock?',
      options: [
        'Pre-emption of held resources',
        'Circular wait',
        'Unlimited resources',
        'Single-threaded execution',
      ],
      correct: 1,
      difficulty: 'HARD',
      topic: 'Concurrency',
      explanation:
        'Mutual exclusion, hold-and-wait, no pre-emption and circular wait must all hold simultaneously.',
    },
    {
      text: 'What is thrashing?',
      options: [
        'Excessive context switching between threads',
        'Spending more time paging than executing',
        'A full disk buffer',
        'A CPU running at maximum clock speed',
      ],
      correct: 1,
      difficulty: 'HARD',
      topic: 'Memory Management',
      explanation: 'When the working set exceeds physical memory, the system pages continuously and makes no progress.',
    },
    {
      text: 'Which system call creates a new process in a POSIX system?',
      options: ['exec()', 'fork()', 'spawn()', 'clone_thread()'],
      correct: 1,
      difficulty: 'EASY',
      topic: 'Process Management',
      explanation: 'fork() duplicates the calling process; exec() replaces the image of an existing one.',
    },
    {
      text: 'What is the purpose of an inode in a Unix file system?',
      options: [
        'Storing the file name',
        'Storing file metadata and data block pointers',
        'Caching directory lookups',
        'Journalling writes',
      ],
      correct: 1,
      difficulty: 'MEDIUM',
      topic: 'File Systems',
      explanation: 'Names live in directory entries; the inode holds permissions, timestamps and block pointers.',
    },
    {
      text: 'A semaphore initialised to 1 behaves as which primitive?',
      options: ['A barrier', 'A mutex', 'A condition variable', 'A spin lock only'],
      correct: 1,
      difficulty: 'MEDIUM',
      topic: 'Concurrency',
      explanation: 'A binary semaphore provides mutual exclusion, though it lacks ownership semantics.',
    },
    {
      text: 'Which page replacement algorithm is provably optimal but not implementable?',
      options: ['LRU', 'FIFO', 'Bélády’s OPT', 'Clock'],
      correct: 2,
      difficulty: 'HARD',
      topic: 'Memory Management',
      explanation: 'OPT evicts the page used furthest in the future, which requires knowledge of future references.',
    },
    {
      text: 'What distinguishes a thread from a process?',
      options: [
        'Threads have separate address spaces',
        'Threads share the address space of their process',
        'Threads cannot be scheduled independently',
        'Threads always run on separate cores',
      ],
      correct: 1,
      difficulty: 'EASY',
      topic: 'Process Management',
      explanation: 'Threads share memory and file descriptors, which is why synchronisation is needed.',
    },
    {
      text: 'What is the role of the MMU?',
      options: [
        'Managing disk I/O queues',
        'Translating virtual addresses to physical addresses',
        'Scheduling processes',
        'Handling interrupts',
      ],
      correct: 1,
      difficulty: 'EASY',
      topic: 'Memory Management',
      explanation: 'The memory management unit performs translation and enforces protection on every access.',
    },
    {
      text: 'Journalling in a file system primarily improves what?',
      options: ['Read throughput', 'Crash consistency', 'Compression ratio', 'Fragmentation'],
      correct: 1,
      difficulty: 'MEDIUM',
      topic: 'File Systems',
      explanation: 'The journal lets recovery replay or discard incomplete operations after an unclean shutdown.',
    },
  ],
  CS303: [
    {
      text: 'Which normal form eliminates transitive dependencies on the primary key?',
      options: ['1NF', '2NF', '3NF', 'BCNF'],
      correct: 2,
      difficulty: 'MEDIUM',
      topic: 'Normalization',
      explanation: 'Third normal form removes non-key attributes that depend on other non-key attributes.',
    },
    {
      text: 'What does the “I” in ACID stand for?',
      options: ['Integrity', 'Isolation', 'Indexing', 'Idempotency'],
      correct: 1,
      difficulty: 'EASY',
      topic: 'Transactions',
      explanation: 'Isolation means concurrent transactions do not observe each other’s intermediate state.',
    },
    {
      text: 'Which isolation level permits phantom reads?',
      options: ['Serializable', 'Repeatable read', 'Read committed', 'Snapshot'],
      correct: 1,
      difficulty: 'HARD',
      topic: 'Transactions',
      explanation:
        'Repeatable read prevents non-repeatable reads of existing rows but classically allows new rows to appear.',
    },
    {
      text: 'What is the main benefit of a B-tree index over a hash index?',
      options: [
        'It supports range queries',
        'It uses less storage',
        'It guarantees O(1) lookup',
        'It requires no maintenance on write',
      ],
      correct: 0,
      difficulty: 'MEDIUM',
      topic: 'Indexing',
      explanation: 'B-trees keep keys ordered, so range and prefix scans are efficient. Hash indexes only do equality.',
    },
    {
      text: 'A foreign key constraint enforces which property?',
      options: ['Entity integrity', 'Referential integrity', 'Domain integrity', 'Atomicity'],
      correct: 1,
      difficulty: 'EASY',
      topic: 'Relational Model',
      explanation: 'It guarantees that a referencing value exists in the referenced relation.',
    },
    {
      text: 'What does a covering index allow the database to avoid?',
      options: [
        'Reading the base table',
        'Acquiring locks',
        'Writing to the transaction log',
        'Parsing the query',
      ],
      correct: 0,
      difficulty: 'HARD',
      topic: 'Indexing',
      explanation: 'If every column the query needs is in the index, the row itself never has to be fetched.',
    },
    {
      text: 'Which anomaly does normalization to 2NF specifically address?',
      options: [
        'Partial dependency on a composite key',
        'Transitive dependency',
        'Multi-valued dependency',
        'Join dependency',
      ],
      correct: 0,
      difficulty: 'MEDIUM',
      topic: 'Normalization',
      explanation: '2NF requires every non-key attribute to depend on the whole composite key, not part of it.',
    },
    {
      text: 'In SQL, what is the difference between DELETE and TRUNCATE?',
      options: [
        'DELETE is row-by-row and can be rolled back per row; TRUNCATE deallocates pages',
        'TRUNCATE supports a WHERE clause',
        'DELETE cannot be rolled back',
        'They are identical',
      ],
      correct: 0,
      difficulty: 'MEDIUM',
      topic: 'Relational Model',
      explanation: 'TRUNCATE is a bulk operation that skips per-row logging and cannot be filtered.',
    },
    {
      text: 'What problem does two-phase locking solve?',
      options: [
        'Deadlock prevention',
        'Serializability of concurrent transactions',
        'Index fragmentation',
        'Query optimisation',
      ],
      correct: 1,
      difficulty: 'HARD',
      topic: 'Transactions',
      explanation: '2PL guarantees conflict-serializable schedules, though it does not by itself prevent deadlock.',
    },
    {
      text: 'Which SQL clause filters rows after aggregation?',
      options: ['WHERE', 'HAVING', 'GROUP BY', 'ORDER BY'],
      correct: 1,
      difficulty: 'EASY',
      topic: 'Relational Model',
      explanation: 'WHERE filters before grouping; HAVING filters the resulting groups.',
    },
    {
      text: 'What is a write-ahead log used for?',
      options: [
        'Caching frequent queries',
        'Ensuring durability and crash recovery',
        'Compressing table data',
        'Enforcing constraints',
      ],
      correct: 1,
      difficulty: 'MEDIUM',
      topic: 'Transactions',
      explanation: 'Changes are logged before being applied, so committed work survives a crash.',
    },
    {
      text: 'Why can an index slow down write-heavy workloads?',
      options: [
        'Every insert and update must also maintain the index',
        'Indexes lock the whole table',
        'Indexes disable the query planner',
        'Indexes prevent batching',
      ],
      correct: 0,
      difficulty: 'MEDIUM',
      topic: 'Indexing',
      explanation: 'Each index is an additional structure to keep consistent on every modification.',
    },
  ],
};

/**
 * Questions exercising the types beyond plain multiple choice, plus a few
 * carrying LaTeX so the maths rendering is visible in the seeded data rather
 * than only reachable by authoring a question by hand.
 */
const EXTRA_QUESTIONS: Record<string, SeedQuestion[]> = {
  CS304: [
    {
      text: 'Which of the following are connectionless protocols?',
      type: 'MCQ_MULTI',
      options: ['UDP', 'TCP', 'IP', 'SCTP'],
      correct: [0, 2],
      difficulty: 'MEDIUM',
      topic: 'Applied Problems',
      explanation:
        'UDP and IP are both connectionless — neither establishes state before sending. TCP and SCTP are connection-oriented.',
    },
    {
      text: 'Expand the acronym TCP.',
      type: 'SHORT_ANSWER',
      acceptedAnswers: ['Transmission Control Protocol', 'Transmission Control Protocol (TCP)'],
      difficulty: 'EASY',
      topic: 'Applied Problems',
      explanation: 'Transmission Control Protocol.',
    },
    {
      text: 'A link has bandwidth $B = 10\\ \\text{Mbps}$ and one-way delay $d = 20\\ \\text{ms}$. Give the bandwidth–delay product in kilobits, to the nearest kilobit.',
      type: 'SHORT_ANSWER',
      acceptedAnswers: ['200'],
      numericTolerance: 1,
      difficulty: 'HARD',
      topic: 'Applied Problems',
      explanation:
        'The product is $B \\times d = 10 \\times 10^6 \\times 0.02 = 2 \\times 10^5$ bits, i.e. 200 kilobits.',
    },
    {
      text: 'Explain why TCP needs both flow control and congestion control, when both slow the sender down. Give one situation each mechanism handles that the other cannot.',
      type: 'LONG_ANSWER',
      difficulty: 'HARD',
      topic: 'Applied Problems',
      maxWords: 250,
      modelAnswer:
        'Flow control protects the receiver: it prevents a fast sender overrunning a slow receiver\'s buffer, driven by the advertised window. Congestion control protects the network: it prevents the sender overrunning intermediate links and queues, driven by loss and delay signals. A fast server sending to a phone with a small buffer needs flow control; a fast server sending to a fast receiver across a saturated link needs congestion control. Full marks require both directions and a distinct scenario for each.',
      sampleAnswers: {
        good: 'Both mechanisms limit the sending rate, but they protect different things. Flow control is driven by the receiver\'s advertised window and stops a fast sender overrunning a slow receiver\'s buffer — for example a server streaming to a phone. Congestion control responds to loss and delay in the network itself and stops the sender overrunning a saturated link shared with other traffic. Neither substitutes for the other: a fast receiver on a congested path still needs congestion control, and an idle network with a slow receiver still needs flow control.',
        weak: 'Flow control and congestion control both slow down the sender so that packets are not lost. They work in a similar way using the window size.',
      },
    },
    {
      text: 'UDP provides no delivery guarantees, yet it is the right choice for live video calls.',
      type: 'TRUE_FALSE',
      correct: 0,
      difficulty: 'EASY',
      topic: 'Applied Problems',
      explanation:
        'True. A retransmitted video frame arrives too late to display, so retransmission costs latency without buying anything. Loss concealment is preferable.',
    },
    {
      text: 'Consider the following statements about the transport layer.',
      type: 'ASSERTION_REASON',
      assertion: 'A UDP sender can transmit faster than the network can carry.',
      reason: 'UDP implements no congestion control.',
      correct: 0,
      difficulty: 'MEDIUM',
      topic: 'Applied Problems',
      explanation:
        'Both are true, and the absence of congestion control is precisely why nothing throttles a UDP sender — so R explains A.',
    },
    {
      text: 'A network uses CIDR block $192.168.10.0/26$. Work out the number of usable host addresses, the broadcast address, and the address range. Photograph your working and upload it.',
      type: 'IMAGE_ANSWER',
      difficulty: 'HARD',
      topic: 'Applied Problems',
      modelAnswer:
        'A /26 leaves 6 host bits, so $2^6 - 2 = 62$ usable addresses. Range 192.168.10.1–192.168.10.62, broadcast 192.168.10.63. Award method marks for correctly identifying 6 host bits even if the arithmetic slips; full marks need all three answers.',
    },
  ],
  CS302: [
    {
      text: 'Consider the following statements about paging.',
      type: 'ASSERTION_REASON',
      assertion: 'Paging eliminates external fragmentation.',
      reason: 'Paging divides physical memory into fixed-size frames.',
      correct: 0,
      difficulty: 'MEDIUM',
      topic: 'Memory Management',
      explanation:
        'Both statements are true, and the fixed frame size is exactly why no unusable gaps form between allocations — so R explains A. Internal fragmentation still occurs within the final frame.',
    },
    {
      text: 'A deadlock can occur even when only one of the four Coffman conditions holds.',
      type: 'TRUE_FALSE',
      correct: 1,
      difficulty: 'EASY',
      topic: 'Concurrency',
      explanation:
        'All four must hold simultaneously — mutual exclusion, hold and wait, no preemption, and circular wait. Breaking any one prevents deadlock.',
    },
    {
      text: 'A system uses a $32$-bit virtual address with a page size of $4\\ \\text{KiB}$. How many bits are used for the page offset?',
      type: 'SHORT_ANSWER',
      acceptedAnswers: ['12', '12 bits'],
      difficulty: 'MEDIUM',
      topic: 'Memory Management',
      explanation: 'A $4\\ \\text{KiB}$ page is $2^{12}$ bytes, so the offset needs $12$ bits.',
    },
    {
      text: 'Three processes arrive at times 0, 2 and 4 with CPU bursts of 7, 4 and 1. Draw the Gantt chart for Shortest Remaining Time First scheduling and compute the average turnaround time. Photograph your working.',
      type: 'IMAGE_ANSWER',
      difficulty: 'HARD',
      topic: 'Process Management',
      modelAnswer:
        'Expected schedule: P1 runs 0–2, P2 2–4 (preempts, remaining 2), P3 4–5, P2 5–7, P1 7–12. Completion 12, 7, 5; turnaround 12, 5, 1; average $(12+5+1)/3 = 6$. Award marks for a correct chart even if the arithmetic slips, and for correct method with one scheduling error.',
    },
  ],
  CS303: [
    {
      text: 'Which of the following anomalies does third normal form (3NF) specifically address?',
      type: 'MCQ_MULTI',
      options: [
        'Transitive dependency on the primary key',
        'Partial dependency on part of a composite key',
        'Update anomalies caused by redundant non-key data',
        'Loss of referential integrity across tables',
      ],
      correct: [0, 2],
      difficulty: 'HARD',
      topic: 'Normalization',
      explanation:
        '3NF removes transitive dependencies, which is what causes the redundant non-key data behind update anomalies. Partial dependency is 2NF; referential integrity is a constraint concern, not a normal form.',
    },
    {
      text: 'Consider the following statements about database transactions.',
      type: 'ASSERTION_REASON',
      assertion: 'A transaction running at SERIALIZABLE isolation cannot experience a phantom read.',
      reason: 'SERIALIZABLE isolation acquires a lock on every row the transaction reads.',
      correct: 1,
      difficulty: 'HARD',
      topic: 'Transactions',
      explanation:
        'A is true — serializable execution is by definition free of phantoms. R is also true of some lock-based implementations, but row locks alone do not prevent phantoms (a new row matching the predicate is not locked); range or predicate locking is required. So R does not explain A.',
    },
    {
      text: 'A relation has $10^6$ rows stored in $5000$ blocks. A B+ tree index on the primary key has height $3$. How many block reads does a single-key lookup require, including the row fetch?',
      type: 'SHORT_ANSWER',
      acceptedAnswers: ['4'],
      numericTolerance: 0,
      difficulty: 'MEDIUM',
      topic: 'Indexing',
      explanation: 'Three reads to walk the tree to a leaf, plus one to fetch the data block: $3 + 1 = 4$.',
    },
    {
      text: 'A colleague proposes dropping the unique index on an orders table because inserts have become slow. Explain what you would measure before agreeing, and what could go wrong if the index is dropped.',
      type: 'LONG_ANSWER',
      difficulty: 'MEDIUM',
      topic: 'Indexing',
      maxWords: 200,
      modelAnswer:
        'Measure first: the share of insert time actually spent maintaining that index, the read queries relying on it, and whether the uniqueness is also enforced by a constraint. Risks: a unique index usually backs a uniqueness constraint, so dropping it permits duplicate orders — a correctness problem, not a performance one — and any query using it for lookups degrades to a scan. Full marks need both the measurement step and the correctness risk, not just the read regression.',
      sampleAnswers: {
        good: 'I would first measure how much of the insert time is actually spent maintaining this index rather than assuming it is the cause — profiling the insert path, and checking how many reads currently use the index. I would also check whether the uniqueness is enforced anywhere else. The main risk is that a unique index usually backs a uniqueness constraint, so dropping it allows duplicate orders to be written. That is a correctness failure, not just a slower query, and it is much harder to undo than the performance problem we started with.',
        weak: 'I would check if the index is being used by any queries. If inserts are slow then dropping the index should make them faster, so it is probably fine to drop it as long as nothing is reading from it.',
      },
    },
  ],
};

const STUDENT_NAMES = [
  'Rahul Verma',
  'Aman Gupta',
  'Priya Sharma',
  'Sneha Iyer',
  'Arjun Nair',
  'Kavya Reddy',
  'Rohan Mehta',
  'Ananya Desai',
  'Vikram Singh',
  'Meera Krishnan',
  'Karthik Rao',
  'Divya Menon',
  'Siddharth Joshi',
  'Nikhil Bose',
  'Ishita Kapoor',
  'Aditya Pillai',
  'Tanvi Bhatt',
  'Harsh Agarwal',
  'Riya Chatterjee',
  'Manav Deshpande',
  'Pooja Nambiar',
  'Yash Kulkarni',
  'Neha Saxena',
  'Ritvik Gangwar',
  'Varun Malhotra',
];

const STUDENT_EMAIL_OVERRIDES: Record<string, string> = {
  'Ritvik Gangwar': 'gangwaritvik@gmail.com',
};

async function main() {
  console.info('Clearing existing seed data…');

  // Order matters: children before parents, since some relations restrict deletes.
  await prisma.$transaction([
    prisma.integrityReview.deleteMany(),
    prisma.integrityScore.deleteMany(),
    prisma.examEvent.deleteMany(),
    prisma.answerOption.deleteMany(),
    prisma.answerAttachment.deleteMany(),
    prisma.answer.deleteMany(),
    prisma.attemptQuestion.deleteMany(),
    prisma.quizAttempt.deleteMany(),
    prisma.quizAssignment.deleteMany(),
    prisma.quiz.deleteMany(),
    prisma.option.deleteMany(),
    prisma.question.deleteMany(),
    prisma.topic.deleteMany(),
    prisma.subject.deleteMany(),
    // Rows only; the files themselves live under UPLOAD_DIR and are left alone,
    // since the seed did not put them there.
    prisma.mediaAsset.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.otpChallenge.deleteMany(),
    prisma.deviceSession.deleteMany(),
    prisma.student.deleteMany(),
    prisma.admin.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  // --- Faculty ------------------------------------------------------------
  console.info('Creating faculty accounts…');

  const faculty = await prisma.admin.create({
    data: {
      employeeId: 'FAC1042',
      department: 'Computer Science',
      title: 'Associate Professor',
      user: {
        create: {
          name: 'Dr. Anita Raghavan',
          email: 'anita.raghavan@college.edu',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      },
    },
  });

  await prisma.admin.create({
    data: {
      employeeId: 'FAC2087',
      department: 'Computer Science',
      title: 'Assistant Professor',
      user: {
        create: {
          name: 'Dr. Sanjay Menon',
          email: 'sanjay.menon@college.edu',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      },
    },
  });

  // --- Students -----------------------------------------------------------
  console.info('Creating students…');

  const students = [];
  for (const [index, name] of STUDENT_NAMES.entries()) {
    const rollNumber = `23CSE${String(index + 1).padStart(3, '0')}`;
    const section = index < 12 ? 'A' : 'B';
    const email =
      STUDENT_EMAIL_OVERRIDES[name] ?? `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@college.edu`;

    students.push(
      await prisma.student.create({
        data: {
          rollNumber,
          department: 'Computer Science',
          section,
          semester: 5,
          enrollmentYear: 2023,
          user: {
            create: {
              name,
              email,
              role: 'STUDENT',
              // One disabled account so the roster filters have something to show.
              status: index === STUDENT_NAMES.length - 1 ? 'DISABLED' : 'ACTIVE',
            },
          },
        },
      }),
    );
  }

  // --- Question bank ------------------------------------------------------
  console.info('Building the question bank…');

  const subjectsByCode = new Map<string, { id: string; topics: Map<string, string> }>();
  // Keyed by question text so the simulated attempts below can write a response
  // that actually answers the question drawn, rather than one canned paragraph.
  const sampleAnswersByQuestion = new Map<string, { good: string; weak: string }>();

  for (const subjectSeed of SUBJECTS) {
    const subject = await prisma.subject.create({
      data: {
        name: subjectSeed.name,
        code: subjectSeed.code,
        topics: { create: subjectSeed.topics.map((name) => ({ name })) },
      },
      include: { topics: true },
    });

    subjectsByCode.set(subjectSeed.code, {
      id: subject.id,
      topics: new Map(subject.topics.map((topic) => [topic.name, topic.id])),
    });

    const seedQuestions = [
      ...(QUESTIONS[subjectSeed.code] ?? []),
      ...(EXTRA_QUESTIONS[subjectSeed.code] ?? []),
    ];

    for (const question of seedQuestions) {
      const type: QuestionType = question.type ?? 'MCQ_SINGLE';
      if (question.sampleAnswers) {
        sampleAnswersByQuestion.set(question.text, question.sampleAnswers);
      }

      // True/false and assertion–reason always use their prescribed option set,
      // exactly as the editor generates them.
      const optionTexts =
        type === 'TRUE_FALSE'
          ? [...TRUE_FALSE_OPTIONS]
          : type === 'ASSERTION_REASON'
            ? [...ASSERTION_REASON_OPTIONS]
            : (question.options ?? []);

      const correctIndexes = new Set(
        Array.isArray(question.correct)
          ? question.correct
          : question.correct === undefined
            ? []
            : [question.correct],
      );

      // Written and uploaded answers are worth more than a single MCQ.
      const marks =
        type === 'LONG_ANSWER' || type === 'IMAGE_ANSWER'
          ? 5
          : question.difficulty === 'HARD'
            ? 2
            : 1;

      await prisma.question.create({
        data: {
          text: question.text,
          type,
          difficulty: question.difficulty,
          marks,
          explanation: question.explanation ?? null,
          subjectId: subject.id,
          topicId: subject.topics.find((topic) => topic.name === question.topic)?.id,
          authorId: faculty.id,
          assertionText: question.assertion ?? null,
          reasonText: question.reason ?? null,
          acceptedAnswers: question.acceptedAnswers ?? [],
          numericTolerance: question.numericTolerance ?? null,
          maxWords: question.maxWords ?? null,
          modelAnswer: question.modelAnswer ?? null,
          ...(optionTexts.length > 0
            ? {
                options: {
                  create: optionTexts.map((text, index) => ({
                    text,
                    isCorrect: correctIndexes.has(index),
                    position: index,
                  })),
                },
              }
            : {}),
        },
      });
    }
  }

  const networks = subjectsByCode.get('CS304')!;
  const os = subjectsByCode.get('CS302')!;
  const databases = subjectsByCode.get('CS303')!;

  // --- Quizzes ------------------------------------------------------------
  console.info('Creating quizzes…');

  const commonSecurity = {
    randomizeQuestions: true,
    randomizeOptions: true,
    singleAttempt: true,
    requireFullscreen: true,
    detectTabSwitch: true,
    blockCopyPaste: true,
    bindDeviceSession: true,
  };

  // Open right now — the one to demo the exam flow with.
  const liveQuiz = await prisma.quiz.create({
    data: {
      title: 'Unit Test 1',
      description: 'Covers units 1 and 2 — layered architecture and transport protocols.',
      subjectId: networks.id,
      authorId: faculty.id,
      status: 'PUBLISHED',
      durationMinutes: 30,
      questionCount: 12,
      easyPct: 30,
      mediumPct: 50,
      hardPct: 20,
      startsAt: hoursFromNow(-1),
      endsAt: hoursFromNow(6),
      releaseResults: true,
      releaseAnswers: false,
      ...commonSecurity,
    },
  });

  // Open now, and pooled to the topic holding one question of every type, so
  // the paper always exercises multi-select, short answer, descriptive and
  // image-upload answers rather than leaving it to the difficulty draw.
  const appliedQuiz = await prisma.quiz.create({
    data: {
      title: 'Assignment 1 — Applied Problems',
      description:
        'Mixed formats: multiple select, short answer, an assertion–reason item, a written answer and a diagram to photograph.',
      subjectId: networks.id,
      authorId: faculty.id,
      status: 'PUBLISHED',
      durationMinutes: 40,
      questionCount: 7,
      poolTopicIds: [networks.topics.get('Applied Problems')!],
      easyPct: 30,
      mediumPct: 40,
      hardPct: 30,
      startsAt: hoursFromNow(-1),
      endsAt: hoursFromNow(12),
      releaseResults: true,
      // Answers released so the marked-up review screen is reachable.
      releaseAnswers: true,
      ...commonSecurity,
    },
  });

  // Scheduled for later, with camera monitoring on.
  const upcomingQuiz = await prisma.quiz.create({
    data: {
      title: 'Mid-Semester Examination',
      description: 'Comprehensive assessment across all units covered so far.',
      subjectId: os.id,
      authorId: faculty.id,
      status: 'PUBLISHED',
      durationMinutes: 45,
      questionCount: 10,
      easyPct: 25,
      mediumPct: 50,
      hardPct: 25,
      startsAt: hoursFromNow(26),
      endsAt: hoursFromNow(30),
      releaseResults: true,
      releaseAnswers: false,
      cameraMonitoring: true,
      ...commonSecurity,
    },
  });

  // Already closed, results and answers released — populates the results screens.
  const pastQuiz = await prisma.quiz.create({
    data: {
      title: 'Quiz 2 — Transactions & Indexing',
      description: 'Short assessment on ACID properties and index selection.',
      subjectId: databases.id,
      authorId: faculty.id,
      status: 'PUBLISHED',
      durationMinutes: 20,
      questionCount: 10,
      easyPct: 30,
      mediumPct: 50,
      hardPct: 20,
      startsAt: hoursFromNow(-72),
      endsAt: hoursFromNow(-68),
      releaseResults: true,
      releaseAnswers: true,
      ...commonSecurity,
    },
  });

  await prisma.quiz.create({
    data: {
      title: 'Unit Test 2 (draft)',
      description: 'Network security and application layer protocols.',
      subjectId: networks.id,
      authorId: faculty.id,
      status: 'DRAFT',
      durationMinutes: 30,
      questionCount: 10,
      easyPct: 20,
      mediumPct: 50,
      hardPct: 30,
      startsAt: hoursFromNow(120),
      endsAt: hoursFromNow(124),
      ...commonSecurity,
    },
  });

  console.info('Assigning quizzes…');

  const activeStudents = students.filter((_, index) => index !== STUDENT_NAMES.length - 1);
  for (const quiz of [liveQuiz, appliedQuiz, upcomingQuiz, pastQuiz]) {
    await prisma.quizAssignment.createMany({
      data: activeStudents.map((student) => ({ quizId: quiz.id, studentId: student.id })),
      skipDuplicates: true,
    });
  }

  // --- Completed attempts for the past quiz -------------------------------
  console.info('Simulating completed attempts…');

  const dbQuestions = await prisma.question.findMany({
    where: { subjectId: databases.id, active: true },
    include: { options: true },
  });

  // A handful of students get deliberate integrity signals so the review
  // workflow has realistic material. The rest sit a clean exam.
  const flaggedIndices = new Set([1, 4]);
  const heavilyFlaggedIndices = new Set([7]);

  for (const [index, student] of activeStudents.slice(0, 18).entries()) {
    const paper = shuffle(dbQuestions).slice(0, pastQuiz.questionCount);
    const startedAt = new Date(hoursFromNow(-70).getTime() + index * 45_000);
    const submittedAt = new Date(startedAt.getTime() + randomInt(11, 19) * 60_000);

    const attempt = await prisma.quizAttempt.create({
      data: {
        quizId: pastQuiz.id,
        studentId: student.id,
        status: 'SUBMITTED',
        attemptNumber: 1,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + pastQuiz.durationMinutes * 60_000),
        submittedAt,
        lastSeenAt: submittedAt,
      },
    });

    // Stronger students answer more correctly; the spread keeps the charts honest.
    const ability = 0.45 + (index % 6) * 0.09;

    let score = 0;
    let maxScore = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;
    let pendingManualCount = 0;

    for (const [position, question] of paper.entries()) {
      maxScore += question.marks;

      const attemptQuestion = await prisma.attemptQuestion.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          position,
          marks: question.marks,
          optionOrder: shuffle(question.options.map((option) => option.id)),
        },
      });

      // A small chance of leaving a question blank, as happens in practice.
      if (randomInt(0, 100) < 6) {
        unansweredCount += 1;
        continue;
      }

      const correctOptions = question.options.filter((option) => option.isCorrect);
      const wrongOptions = question.options.filter((option) => !option.isCorrect);
      const answersWell = Math.random() < ability;

      // Build a plausible response for whichever type this question is.
      let selectedOptionId: string | null = null;
      let selectedOptionIds: string[] = [];
      let textResponse: string | null = null;

      if (question.type === 'MCQ_MULTI') {
        selectedOptionIds = answersWell
          ? correctOptions.map((option) => option.id)
          : // A near miss: most of the key, plus one wrong tick.
            [
              ...correctOptions.slice(0, Math.max(1, correctOptions.length - 1)).map((o) => o.id),
              ...(wrongOptions.length > 0 ? [pick(wrongOptions).id] : []),
            ];
      } else if (question.type === 'SHORT_ANSWER') {
        textResponse = answersWell
          ? (question.acceptedAnswers[0] ?? '')
          : 'Not sure — I ran out of time on this one.';
      } else if (question.type === 'LONG_ANSWER') {
        const samples = sampleAnswersByQuestion.get(question.text);
        textResponse = samples
          ? answersWell
            ? samples.good
            : samples.weak
          : 'I ran out of time and could not finish this answer.';
      } else if (question.type === 'IMAGE_ANSWER') {
        // Nothing to attach without real image bytes, so this one is left blank.
        unansweredCount += 1;
        continue;
      } else {
        const chosen = answersWell ? pick(correctOptions) : pick(wrongOptions);
        selectedOptionId = chosen.id;
      }

      // Graded by the same functions the live exam uses.
      const gradable: GradableQuestion = {
        type: question.type,
        marks: question.marks,
        negativeMarks: question.negativeMarks,
        partialCredit: question.partialCredit,
        acceptedAnswers: question.acceptedAnswers,
        caseSensitive: question.caseSensitive,
        numericTolerance: question.numericTolerance,
        correctOptionIds: correctOptions.map((option) => option.id),
      };

      const outcome = gradeAnswer(gradable, {
        selectedOptionId,
        selectedOptionIds,
        textResponse,
        attachmentCount: 0,
      });

      const answer = await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          attemptQuestionId: attemptQuestion.id,
          selectedOptionId,
          textResponse,
          isCorrect: outcome.isCorrect,
          awardedMarks: outcome.awardedMarks,
          requiresManualGrading: outcome.state === 'MANUAL',
          answeredAt: new Date(startedAt.getTime() + position * 60_000),
        },
      });

      if (selectedOptionIds.length > 0) {
        await prisma.answerOption.createMany({
          data: selectedOptionIds.map((optionId) => ({ answerId: answer.id, optionId })),
        });
      }

      if (outcome.state === 'MANUAL') {
        // Leave most awaiting a marker so the marking queue has real work in it;
        // mark a few so the "already marked" view is populated too.
        if (index % 4 === 0) {
          const awarded = answersWell ? question.marks : Math.round(question.marks * 0.4);
          await prisma.answer.update({
            where: { id: answer.id },
            data: {
              awardedMarks: awarded,
              isCorrect: awarded >= question.marks,
              gradedById: faculty.id,
              gradedAt: new Date(submittedAt.getTime() + 3 * 60 * 60 * 1000),
              graderNote: answersWell
                ? 'Well structured, and you covered both halves of what the question asked for.'
                : 'You describe the mechanism but stop short of the reasoning the question asked for. Work through the second half in the same detail as the first.',
            },
          });
          score += awarded;
          if (awarded >= question.marks) correctCount += 1;
          else incorrectCount += 1;
        } else {
          pendingManualCount += 1;
        }
        continue;
      }

      score += outcome.awardedMarks ?? 0;
      if (outcome.isCorrect === true) correctCount += 1;
      else if (outcome.isCorrect === false) incorrectCount += 1;
    }

    score = Math.max(0, score);

    await prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        score,
        maxScore,
        percentage: maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0,
        correctCount,
        incorrectCount,
        unansweredCount,
        pendingManualCount,
        manualGradedAt: pendingManualCount === 0 ? submittedAt : null,
      },
    });

    // --- Events ----------------------------------------------------------
    const events: Array<{ type: ExamEventType; offsetMs: number; durationMs?: number }> = [
      { type: 'ATTEMPT_STARTED', offsetMs: 0 },
      { type: 'FULLSCREEN_ENTER', offsetMs: 2_000 },
    ];

    if (flaggedIndices.has(index)) {
      events.push(
        { type: 'FULLSCREEN_EXIT', offsetMs: 6 * 60_000, durationMs: 3_000 },
        { type: 'FULLSCREEN_ENTER', offsetMs: 6 * 60_000 + 3_000 },
        { type: 'WINDOW_BLUR', offsetMs: 9 * 60_000, durationMs: 2_000 },
        { type: 'WINDOW_FOCUS', offsetMs: 9 * 60_000 + 2_000 },
        { type: 'NETWORK_OFFLINE', offsetMs: 12 * 60_000, durationMs: 5_000 },
        { type: 'NETWORK_ONLINE', offsetMs: 12 * 60_000 + 5_000 },
      );
    }

    if (heavilyFlaggedIndices.has(index)) {
      events.push(
        { type: 'TAB_SWITCH', offsetMs: 4 * 60_000, durationMs: 9_000 },
        { type: 'WINDOW_FOCUS', offsetMs: 4 * 60_000 + 9_000 },
        { type: 'TAB_SWITCH', offsetMs: 8 * 60_000, durationMs: 14_000 },
        { type: 'WINDOW_FOCUS', offsetMs: 8 * 60_000 + 14_000 },
        { type: 'COPY_ATTEMPT', offsetMs: 9 * 60_000 },
        { type: 'FULLSCREEN_EXIT', offsetMs: 10 * 60_000, durationMs: 21_000 },
        { type: 'FULLSCREEN_ENTER', offsetMs: 10 * 60_000 + 21_000 },
        { type: 'PASTE_ATTEMPT', offsetMs: 11 * 60_000 },
      );
    }

    events.push({ type: 'ATTEMPT_SUBMITTED', offsetMs: submittedAt.getTime() - startedAt.getTime() });

    await prisma.examEvent.createMany({
      data: events.map((event) => ({
        attemptId: attempt.id,
        type: event.type,
        severity:
          event.type === 'PASTE_ATTEMPT' || event.type === 'TAB_SWITCH'
            ? ('MEDIUM' as const)
            : event.type === 'COPY_ATTEMPT' || event.type === 'FULLSCREEN_EXIT'
              ? ('MEDIUM' as const)
              : event.type === 'WINDOW_BLUR' || event.type === 'NETWORK_OFFLINE'
                ? ('LOW' as const)
                : ('INFO' as const),
        occurredAt: new Date(startedAt.getTime() + event.offsetMs),
        durationMs: event.durationMs ?? null,
      })),
    });
  }

  // Scored by the real engine, so seeded data and live data go through exactly
  // the same code path. `integrity-engine` is deliberately free of database and
  // `server-only` imports precisely so this is possible.
  console.info('Computing integrity scores…');
  const { computeIntegrity } = await import('../src/lib/integrity-engine');

  const attempts = await prisma.quizAttempt.findMany({ select: { id: true } });
  for (const attempt of attempts) {
    const events = await prisma.examEvent.findMany({
      where: { attemptId: attempt.id },
      select: { type: true, durationMs: true },
    });
    const computation = computeIntegrity(events);

    await prisma.integrityScore.create({
      data: {
        attemptId: attempt.id,
        score: computation.score,
        status: computation.status,
        breakdown: computation.breakdown as unknown as object,
      },
    });
  }

  console.info('\nSeed complete.\n');
  console.info('Sign in with the development OTP shown on the login screen:');
  console.info('  Faculty  anita.raghavan@college.edu  (or employee login by email)');
  console.info('  Student  23CSE001  (Rahul Verma)');
  console.info('  Student  23CSE008  (Ananya Desai — has integrity signals to review)\n');
  console.info(`  ${STUDENT_NAMES.length} students · ${attempts.length} completed attempts`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
