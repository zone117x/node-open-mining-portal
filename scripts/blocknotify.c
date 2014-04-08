#include <sys/socket.h>
#include <netinet/in.h>
#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>

/*

Contributed by Alex Petrov aka SysMan at sysman.net

Part of NOMP project
Simple lightweight & fast - a more efficient block notify script in pure C.

(may also work as coin switch)

Platforms : Linux,BSD,Solaris (mostly OS independent)

Build with:
    gcc blocknotify.c -o blocknotify


Usage in daemon coin.conf
    blocknotify="/bin/blocknotify localhost:8117 mySuperSecurePassword dogecoin %s"


// {"password":"notepas","coin":"Xcoin","hash":"d2191a8b644c9cd903439edf1d89ee060e196b3e116e0d48a3f11e5e3987a03b"}
// simplest connect + send json string to server

# $Id: blocknotify.c,v 0.1 2014/04/07 22:38:09 sysman Exp $
*/


int main(int argc, char **argv)
{
   int sockfd,n;
   struct sockaddr_in servaddr,cliaddr;
   char sendline[1000];
   char recvline[1000];
   char host[200];
   char *p,*arg,*errptr;
   int port;

   if (argc < 4)
   {
	// print help
      printf("NOMP pool block notify\n usage: <host:port> <password> <coin> <block>\n");
      exit(1);
   }

 strncpy(host,argv[1],(sizeof(host)-1));
  p=host;

if ( (arg=strchr(p,':')) ) 
 { *arg='\0';

 errno=0; // reset errno
 port=strtol(++arg,&errptr,10);

if ( (errno != 0) || (errptr == arg) ) { fprintf(stderr, "port number fail [%s]\n",errptr); }
// if(strlen(arg) > (errptr-arg) ) also fail, but we ignore it for now
// printf("host %s:%d\n",host,port);
}

// printf("pass: %s coin: %s  block:[%s]\n",argv[2],argv[3],argv[4]);
snprintf(sendline,sizeof(sendline)-1,
 "{\"password\":\"%s\",\"coin\":\"%s\",\"hash\":\"%s\"}\n",
		argv[2],	argv[3],	argv[4]);

// printf("sendline:[%s]",sendline);

   sockfd=socket(AF_INET,SOCK_STREAM,0);

   bzero(&servaddr,sizeof(servaddr));
   servaddr.sin_family = AF_INET;
   servaddr.sin_addr.s_addr=inet_addr(host);
   servaddr.sin_port=htons(port);

   connect(sockfd, (struct sockaddr *)&servaddr, sizeof(servaddr));

      sendto(sockfd,sendline,strlen(sendline),0,
             (struct sockaddr *)&servaddr,sizeof(servaddr));
exit(0);
}
