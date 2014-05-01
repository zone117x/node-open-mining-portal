#include <sys/socket.h>
#include <netinet/in.h>
#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>

/*

Contributed by Alex Petrov aka SysMan at sysman.net
Updated by Alejandro Reyero - TodoJuegos.com

Part of NOMP project
Simple lightweight & fast - a more efficient block notify script in pure C.

(may also work as coin switch)

Platforms : Linux, BSD, Solaris (mostly OS independent)

Build with:
    gcc blocknotify.c -o blocknotify


Example usage in daemon coin.conf using default NOMP CLI port of 17117
    blocknotify="/bin/blocknotify 127.0.0.1:17117 dogecoin %s"



*/


int main(int argc, char **argv)
{
    int sockfd,n;
    struct sockaddr_in servaddr, cliaddr;
    char sendline[1000];
    char recvline[1000];
    char host[200];
    char *p, *arg, *errptr;
    int port;

    if (argc < 3)
    {
        // print help
        printf("NOMP pool block notify\n usage: <host:port> <coin> <block>\n");
        exit(1);
    }

    strncpy(host, argv[1], (sizeof(host)-1));
    p = host;

    if ( (arg = strchr(p,':')) )
    {
        *arg = '\0';

        errno = 0; // reset errno
        port = strtol(++arg, &errptr, 10);

        if ( (errno != 0) || (errptr == arg) )
        {
            fprintf(stderr, "port number fail [%s]\n", errptr);
        }

	}

	snprintf(sendline, sizeof(sendline) - 1, "{\"command\":\"blocknotify\",\"params\":[\"%s\",\"%s\"]}\n", argv[2], argv[3]);

	sockfd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
	bzero(&servaddr, sizeof(servaddr));
	servaddr.sin_family = AF_INET;
	servaddr.sin_addr.s_addr = inet_addr(host);
	servaddr.sin_port = htons(port);
	connect(sockfd, (struct sockaddr *)&servaddr, sizeof(servaddr));

	int result = send(sockfd, sendline, strlen(sendline), 0);
	close(sockfd);

	if(result == -1) {
		printf("Error sending: %i\n", errno);
        exit(-1);
	}
	exit(0);
}
